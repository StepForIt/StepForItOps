import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ExternalProbe,
  MONITOR_ADMIN_PORT,
  MonitorAdminPort,
  N8nWorkflow,
  extractUrlHost,
  extractWebhookPath,
  workflowWebhookPaths,
} from '@nwm/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { callKuma } from './kuma-errors';

interface MatchedWorkflow {
  id: string;
  name: string;
}

/** Sonde Kuma annotée de son état côté plateforme. */
export interface ImportableProbe extends ExternalProbe {
  /** Monitor local déjà rattaché à cette sonde (via kumaMonitorId ou pushUrl). */
  linkedMonitorId: string | null;
  /** Workflow dont l'URL de la sonde cible un webhook (rattachement automatique à l'import). */
  matchedWorkflow: MatchedWorkflow | null;
  /** Importable = pas encore rattachée et type concret (pas un groupe). */
  importable: boolean;
}

export interface KumaImportResult {
  imported: Array<{ externalId: number; name: string; monitorId: string; workflowName: string | null }>;
  skipped: Array<{ externalId: number; name: string; reason: string }>;
}

/**
 * Import des monitors Uptime Kuma pré-existants en monitors locaux :
 * push → heartbeat ; http/keyword/ping… → active (désactivé par défaut, Kuma
 * continue de faire le check), rattaché au workflow ciblé par l'URL de webhook.
 */
@Injectable()
export class KumaImportService {
  private readonly logger = new Logger(KumaImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MONITOR_ADMIN_PORT) private readonly kumaAdmin: MonitorAdminPort,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Liste les monitors Kuma avec leur état de rattachement local et le workflow détecté. */
  async listProbes(): Promise<ImportableProbe[]> {
    if (!(await this.kumaAdmin.isConfigured())) {
      throw new BadRequestException(
        'Uptime Kuma non configuré : renseigner les réglages Kuma (page Monitors) ou KUMA_URL/KUMA_USERNAME/KUMA_PASSWORD dans le .env',
      );
    }
    const [probes, monitors] = await Promise.all([
      callKuma('lecture des monitors', () => this.kumaAdmin.listProbes()),
      this.prisma.monitor.findMany({ select: { id: true, kumaPushUrl: true, config: true } }),
    ]);
    const matched = await this.matchWorkflows(probes);

    const byKumaId = new Map<number, string>();
    const byPushUrl = new Map<string, string>();
    for (const monitor of monitors) {
      const kumaMonitorId = (monitor.config as { kumaMonitorId?: number } | null)?.kumaMonitorId;
      if (kumaMonitorId !== undefined) byKumaId.set(kumaMonitorId, monitor.id);
      if (monitor.kumaPushUrl) byPushUrl.set(monitor.kumaPushUrl, monitor.id);
    }

    return probes.map((probe) => {
      const linkedMonitorId =
        byKumaId.get(probe.externalId) ?? (probe.pushUrl ? byPushUrl.get(probe.pushUrl) : undefined) ?? null;
      return {
        ...probe,
        linkedMonitorId,
        matchedWorkflow: matched.get(probe.externalId) ?? null,
        importable: probe.type !== 'group' && linkedMonitorId === null,
      };
    });
  }

  /** Crée les monitors locaux pour les sondes sélectionnées. */
  async importProbes(externalIds: number[]): Promise<KumaImportResult> {
    if (!externalIds?.length) {
      throw new BadRequestException('Aucune sonde sélectionnée');
    }
    const probes = await this.listProbes();
    const byId = new Map(probes.map((p) => [p.externalId, p]));

    const result: KumaImportResult = { imported: [], skipped: [] };
    for (const externalId of externalIds) {
      const probe = byId.get(externalId);
      if (!probe) {
        result.skipped.push({ externalId, name: `#${externalId}`, reason: 'introuvable côté Kuma' });
        continue;
      }
      if (!probe.importable) {
        const reason = probe.linkedMonitorId
          ? 'déjà rattachée à un monitor local'
          : `type "${probe.type}" non importable`;
        result.skipped.push({ externalId, name: probe.name, reason });
        continue;
      }
      const monitor = await this.prisma.monitor.create({ data: this.toMonitorData(probe) });
      result.imported.push({
        externalId,
        name: probe.name,
        monitorId: monitor.id,
        workflowName: probe.matchedWorkflow?.name ?? null,
      });
    }
    this.logger.log(
      `Import Kuma : ${result.imported.length} sondes importées, ${result.skipped.length} ignorées`,
    );
    return result;
  }

  private toMonitorData(probe: ImportableProbe): Prisma.MonitorCreateInput {
    // importedFromKuma : la sonde appartient à Kuma → la suppression locale ne la détruit pas
    const base = {
      // Retire le préfixe des sondes créées par la plateforme, au cas où
      name: probe.name.replace(/^\[n8n-ops\]\s*/, ''),
      workflow: probe.matchedWorkflow ? { connect: { id: probe.matchedWorkflow.id } } : undefined,
    };
    if (probe.type === 'push') {
      return {
        ...base,
        kind: 'heartbeat',
        kumaPushUrl: probe.pushUrl,
        config: { kumaMonitorId: probe.externalId, importedFromKuma: true },
      };
    }
    // Kuma continue de checker lui-même → désactivé localement pour ne pas doubler
    // les appels (un check actif sur un webhook déclenche le workflow).
    return {
      ...base,
      kind: 'active',
      enabled: false,
      config: {
        kumaMonitorId: probe.externalId,
        importedFromKuma: true,
        kumaType: probe.type,
        url: probe.url,
        intervalSeconds: probe.intervalSeconds,
      },
    };
  }

  /** Rattache chaque sonde ayant une URL de webhook au workflow qui expose ce webhook. */
  private async matchWorkflows(probes: ExternalProbe[]): Promise<Map<number, MatchedWorkflow>> {
    const matched = new Map<number, MatchedWorkflow>();
    const withPath = probes
      .map((probe) => ({ probe, path: probe.url ? extractWebhookPath(probe.url) : null }))
      .filter((entry): entry is { probe: ExternalProbe; path: string } => entry.path !== null);
    if (!withPath.length) return matched;

    const workflows = await this.prisma.workflow.findMany({
      where: await this.settings.workflowFilter(),
      select: { id: true, name: true, raw: true, instance: { select: { baseUrl: true } } },
    });
    const candidates = workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      host: extractUrlHost(workflow.instance.baseUrl),
      paths: new Set(workflowWebhookPaths(workflow.raw as unknown as N8nWorkflow)),
    }));

    for (const { probe, path } of withPath) {
      const host = probe.url ? extractUrlHost(probe.url) : null;
      const byPath = candidates.filter((c) => c.paths.has(path));
      // Même chemin sur plusieurs instances : l'hôte de l'URL départage
      const best = byPath.find((c) => c.host === host) ?? (byPath.length === 1 ? byPath[0] : undefined);
      if (best) matched.set(probe.externalId, { id: best.id, name: best.name });
    }
    return matched;
  }
}
