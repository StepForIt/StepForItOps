import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MONITOR_ADMIN_PORT, MonitorAdminPort, ProbeIntervalUpdate, msg } from '@nwm/core';
import { Monitor } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';
import { callKuma } from './kuma-errors';
import { DEFAULT_ERROR_WATCH_INTERVAL_SECONDS, probeIntervalSeconds } from './probe-interval';

export interface InstanceProvisionResult {
  created: Array<{ workflowName: string; monitorId: string; pushUrl: string }>;
  skipped: string[];
  /** Monitor error-watch de l'instance (créé à cette occasion ou déjà présent). */
  errorWatch: { monitorId: string; pushUrl: string; created: boolean };
}

export interface ProbeIntervalSyncResult {
  updated: Array<{ monitorId: string; name: string; fromSeconds?: number; toSeconds: number }>;
  /** Sondes déjà à la bonne cadence. */
  unchanged: number;
  skipped: Array<{ name: string; reason: string }>;
}

/** Champs posés par le provisioning dans Monitor.config. */
interface ProvisioningConfig {
  kumaMonitorId?: number;
  importedFromKuma?: boolean;
}

/** Création automatique des sondes push Uptime Kuma (+ monitors locaux). */
@Injectable()
export class KumaProvisioningService {
  private readonly logger = new Logger(KumaProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MONITOR_ADMIN_PORT) private readonly kumaAdmin: MonitorAdminPort,
    private readonly settings: PlatformSettingsService,
    private readonly platformLocale: PlatformLocale,
  ) {}

  async status(): Promise<{ configured: boolean }> {
    return { configured: await this.kumaAdmin.isConfigured() };
  }

  private async requireConfigured(): Promise<void> {
    if (!(await this.kumaAdmin.isConfigured())) {
      throw new BadRequestException(msg('ops.kumaNotConfigured'));
    }
  }

  /** Crée la sonde Kuma pour un monitor existant et renseigne kumaPushUrl. */
  async provisionMonitor(monitorId: string): Promise<Monitor> {
    await this.requireConfigured();
    const monitor = await this.prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!monitor) throw new NotFoundException(msg('ops.monitorNotFound', { id: monitorId }));
    if (monitor.kumaPushUrl && (await this.probeExists(monitor))) return monitor;

    // L'intervalle doit suivre la cadence de push du monitor, sinon Kuma alerte sur des beats
    // qui ne sont simplement pas encore dus (cf. probe-interval.ts).
    const probe = await callKuma(msg('ops.kumaActionCreatePushProbe'), () =>
      this.kumaAdmin.createPushProbe(`[n8n-ops] ${monitor.name}`, probeIntervalSeconds(monitor)),
    );
    this.logger.log(`Kuma probe #${probe.externalId} created for "${monitor.name}"`);
    return this.prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        kumaPushUrl: probe.pushUrl,
        config: {
          ...((monitor.config as object | null) ?? {}),
          kumaMonitorId: probe.externalId,
        },
      },
    });
  }

  /**
   * Kuma reste maître de ses sondes : une URL en base ne prouve pas que la sonde vit encore,
   * et Kuma injoignable remonte en erreur plutôt que de recréer un doublon à l'aveugle.
   */
  private async probeExists(monitor: Monitor): Promise<boolean> {
    const externalId = (monitor.config as ProvisioningConfig | null)?.kumaMonitorId;
    if (!externalId) return false;
    const probes = await callKuma(msg('ops.kumaActionReadProbes'), () => this.kumaAdmin.listProbes());
    return probes.some((probe) => probe.externalId === externalId);
  }

  /**
   * "En un clin d'œil" : pour chaque workflow actif de l'instance sans monitor heartbeat,
   * crée le monitor local + la sonde push Kuma correspondante.
   */
  async provisionInstance(instanceId: string): Promise<InstanceProvisionResult> {
    await this.requireConfigured();
    const instance = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundException(msg('ops.instanceNotFound', { id: instanceId }));

    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, active: true, ...(await this.settings.workflowFilter()) },
      include: { monitors: true },
    });

    const errorWatch = await this.ensureErrorWatch(instanceId, instance.name);
    const result: InstanceProvisionResult = { created: [], skipped: [], errorWatch };
    for (const workflow of workflows) {
      if (workflow.monitors.some((m) => m.kind === 'heartbeat')) {
        result.skipped.push(workflow.name);
        continue;
      }
      const monitor = await this.prisma.monitor.create({
        data: {
          workflowId: workflow.id,
          name: `${instance.name} / ${workflow.name}`,
          kind: 'heartbeat',
        },
      });
      const provisioned = await this.provisionMonitor(monitor.id);
      result.created.push({
        workflowName: workflow.name,
        monitorId: monitor.id,
        pushUrl: provisioned.kumaPushUrl ?? '',
      });
    }
    this.logger.log(
      `Instance "${instance.name}": ${result.created.length} probes created, ${result.skipped.length} already covered`,
    );
    return result;
  }

  /** Crée (si absent) le monitor error-watch de l'instance + sa sonde push Kuma. */
  private async ensureErrorWatch(
    instanceId: string,
    instanceName: string,
  ): Promise<InstanceProvisionResult['errorWatch']> {
    const existing = await this.prisma.monitor.findFirst({
      where: { kind: 'error-watch', config: { path: ['instanceId'], equals: instanceId } },
    });
    if (existing) {
      // Repasse par le provisioning : la sonde a pu disparaître côté Kuma depuis la création.
      const repaired = await this.provisionMonitor(existing.id);
      return { monitorId: repaired.id, pushUrl: repaired.kumaPushUrl ?? '', created: false };
    }
    const monitor = await this.prisma.monitor.create({
      data: {
        name: this.platformLocale.run(() => msg('ops.errorWatchMonitorName', { instance: instanceName })),
        kind: 'error-watch',
        config: { instanceId, intervalSeconds: DEFAULT_ERROR_WATCH_INTERVAL_SECONDS },
      },
    });
    const provisioned = await this.provisionMonitor(monitor.id);
    this.logger.log(`error-watch monitor created for instance "${instanceName}"`);
    return { monitorId: monitor.id, pushUrl: provisioned.kumaPushUrl ?? '', created: true };
  }

  /**
   * Réaligne l'intervalle des sondes Kuma déjà créées sur la cadence de push de leur monitor.
   * Sans `monitorId`, passe sur tout le parc (rattrapage des sondes créées avant ce calcul).
   * Les sondes importées depuis Kuma sont laissées telles quelles : elles lui appartiennent.
   */
  async syncProbeIntervals(monitorId?: string): Promise<ProbeIntervalSyncResult> {
    await this.requireConfigured();
    const monitors = await this.prisma.monitor.findMany({ where: monitorId ? { id: monitorId } : {} });
    const probes = await callKuma(msg('ops.kumaActionReadProbes'), () => this.kumaAdmin.listProbes());
    const byExternalId = new Map(probes.map((p) => [p.externalId, p]));

    const result: ProbeIntervalSyncResult = { updated: [], unchanged: 0, skipped: [] };
    const updates: ProbeIntervalUpdate[] = [];

    for (const monitor of monitors) {
      const config = (monitor.config ?? {}) as ProvisioningConfig;
      if (config.importedFromKuma) {
        result.skipped.push({ name: monitor.name, reason: msg('ops.kumaSkipImported') });
        continue;
      }
      if (config.kumaMonitorId === undefined) {
        result.skipped.push({ name: monitor.name, reason: msg('ops.kumaSkipNoProbe') });
        continue;
      }
      const probe = byExternalId.get(config.kumaMonitorId);
      if (!probe) {
        result.skipped.push({
          name: monitor.name,
          reason: msg('ops.kumaSkipProbeMissing', { id: String(config.kumaMonitorId) }),
        });
        continue;
      }
      const toSeconds = probeIntervalSeconds(monitor);
      if (probe.intervalSeconds === toSeconds) {
        result.unchanged++;
        continue;
      }
      updates.push({ externalId: config.kumaMonitorId, intervalSeconds: toSeconds });
      result.updated.push({
        monitorId: monitor.id,
        name: monitor.name,
        fromSeconds: probe.intervalSeconds,
        toSeconds,
      });
    }

    await callKuma(msg('ops.kumaActionUpdateIntervals'), () => this.kumaAdmin.setProbeIntervals(updates));
    if (result.updated.length > 0) {
      this.logger.log(`Kuma intervals realigned: ${result.updated.map((u) => u.name).join(', ')}`);
    }
    return result;
  }

  /**
   * Supprime un monitor local ET sa sonde Kuma (best effort) — sauf si la sonde a été
   * importée depuis Kuma (importedFromKuma) : elle appartient à Kuma et reste intacte.
   */
  async deleteWithProbe(monitorId: string): Promise<Monitor> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!monitor) throw new NotFoundException(msg('ops.monitorNotFound', { id: monitorId }));

    const config = monitor.config as { kumaMonitorId?: number; importedFromKuma?: boolean } | null;
    const kumaMonitorId = config?.kumaMonitorId;
    if (kumaMonitorId !== undefined && !config?.importedFromKuma && (await this.kumaAdmin.isConfigured())) {
      try {
        await this.kumaAdmin.deleteProbe(kumaMonitorId);
      } catch (error) {
        this.logger.warn(`Kuma probe #${kumaMonitorId} deletion failed: ${(error as Error).message}`);
      }
    }
    return this.prisma.monitor.delete({ where: { id: monitorId } });
  }
}
