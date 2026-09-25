import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EVENTS, envIds, normalizeEnvs } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import {
  CONFIG_BUNDLE_KIND,
  CONFIG_BUNDLE_VERSION,
  ConfigBundle,
  ImportReport,
  ImportStrategy,
  MonitorEntry,
  SectionReport,
  WorkflowRef,
} from './config-bundle.types';
import { ConfigImportWorkflowScopedService } from './config-import-workflow-scoped.service';
import { WorkflowRefResolver } from './workflow-ref.resolver';
import { monitorInstanceId, withInstanceId } from './monitor-instance-ref';

@Injectable()
export class ConfigImportService {
  private readonly logger = new Logger(ConfigImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly registry: ModuleRegistryService,
    private readonly refs: WorkflowRefResolver,
    private readonly workflowScoped: ConfigImportWorkflowScopedService,
  ) {}

  async importBundle(bundle: ConfigBundle, strategy: ImportStrategy, dryRun: boolean): Promise<ImportReport> {
    this.validate(bundle);
    // Les ids résolus au tour précédent sont périmés (workflows resynchronisés entre-temps).
    this.refs.reset();

    const report: ImportReport = {
      dryRun,
      strategy,
      sections: {
        instances: { created: 0, updated: 0, skipped: 0 },
        exportTargets: { created: 0, updated: 0, skipped: 0 },
        resourceMappings: { created: 0, updated: 0, skipped: 0 },
        monitors: { created: 0, updated: 0, skipped: 0 },
        monitoringSettings: { created: 0, updated: 0, skipped: 0 },
        aiSettings: { created: 0, updated: 0, skipped: 0 },
        moduleStates: { created: 0, updated: 0, skipped: 0 },
        platformSettings: { created: 0, updated: 0, skipped: 0 },
        findingIgnores: { created: 0, updated: 0, skipped: 0 },
        workflowGroups: { created: 0, updated: 0, skipped: 0 },
        workflowLinks: { created: 0, updated: 0, skipped: 0 },
      },
      warnings: [],
    };

    await this.importInstances(bundle, strategy, dryRun, report);
    await this.importExportTargets(bundle, strategy, dryRun, report);
    await this.importResourceMappings(bundle, strategy, dryRun, report);
    await this.importMonitors(bundle, strategy, dryRun, report);
    await this.importMonitoringSettings(bundle, strategy, dryRun, report);
    await this.importAiSettings(bundle, strategy, dryRun, report);
    await this.importModuleStates(bundle, strategy, dryRun, report);
    await this.importPlatformSettings(bundle, strategy, dryRun, report);
    await this.workflowScoped.importAll(bundle, strategy, dryRun, report, (e, s, section) =>
      this.act(e, s, section),
    );

    if (!dryRun) {
      const totals = Object.values(report.sections).reduce(
        (acc, s) => ({
          created: acc.created + s.created,
          updated: acc.updated + s.updated,
          skipped: acc.skipped + s.skipped,
        }),
        { created: 0, updated: 0, skipped: 0 },
      );
      this.eventBus.emit(EVENTS.configImported, { ...totals, sections: Object.keys(report.sections) });
      this.logger.log(
        `Config importée : ${totals.created} créés, ${totals.updated} mis à jour, ${totals.skipped} ignorés`,
      );
    }
    return report;
  }

  private validate(bundle: ConfigBundle): void {
    if (!bundle || bundle.kind !== CONFIG_BUNDLE_KIND) {
      throw new BadRequestException(
        "Fichier invalide : ce n'est pas un export de configuration de la plateforme",
      );
    }
    if (bundle.version !== CONFIG_BUNDLE_VERSION) {
      throw new BadRequestException(
        `Version de bundle non supportée : ${bundle.version} (attendu : ${CONFIG_BUNDLE_VERSION})`,
      );
    }
  }

  /** skip-existing : ne touche jamais une entrée existante ; merge : la met à jour. */
  private act(
    existing: boolean,
    strategy: ImportStrategy,
    section: SectionReport,
  ): 'create' | 'update' | 'skip' {
    if (!existing) {
      section.created++;
      return 'create';
    }
    if (strategy === 'skip-existing') {
      section.skipped++;
      return 'skip';
    }
    section.updated++;
    return 'update';
  }

  private async importInstances(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.instances ?? []) {
      const existing = await this.prisma.instance.findFirst({ where: { baseUrl: entry.baseUrl } });
      const action = this.act(!!existing, strategy, report.sections.instances);
      if (action === 'skip') continue;
      if (action === 'create' && entry.apiKey === null) {
        report.warnings.push(
          `Instance "${entry.name}" créée sans apiKey (export sans secrets) : à renseigner manuellement`,
        );
      }
      if (dryRun) continue;
      if (action === 'create') {
        await this.prisma.instance.create({
          data: { name: entry.name, baseUrl: entry.baseUrl, apiKey: entry.apiKey ?? '' },
        });
      } else if (existing) {
        // apiKey null = secrets exclus de l'export → on garde la clé locale.
        await this.prisma.instance.update({
          where: { id: existing.id },
          data: { name: entry.name, ...(entry.apiKey !== null ? { apiKey: entry.apiKey } : {}) },
        });
      }
    }
  }

  private async importExportTargets(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.exportTargets ?? []) {
      const existing = await this.prisma.exportTarget.findFirst({
        where: { kind: entry.kind, name: entry.name },
      });
      const action = this.act(!!existing, strategy, report.sections.exportTargets);
      if (action === 'skip') continue;
      if (action === 'create' && !bundle.includesSecrets) {
        report.warnings.push(
          `Cible export "${entry.name}" créée sans ses secrets (token…) : à renseigner manuellement`,
        );
      }
      if (dryRun) continue;
      const config = (entry.config ?? {}) as Prisma.InputJsonValue;
      if (action === 'create') {
        await this.prisma.exportTarget.create({
          data: { kind: entry.kind, name: entry.name, config, enabled: entry.enabled },
        });
      } else if (existing) {
        // Sans secrets dans le bundle, on fusionne pour ne pas écraser les tokens locaux.
        const merged = bundle.includesSecrets
          ? entry.config
          : { ...((existing.config ?? {}) as Record<string, unknown>), ...entry.config };
        await this.prisma.exportTarget.update({
          where: { id: existing.id },
          data: { config: merged as Prisma.InputJsonValue, enabled: entry.enabled },
        });
      }
    }
  }

  private async importResourceMappings(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.resourceMappings ?? []) {
      const existing = await this.prisma.resourceMapping.findFirst({
        where: { provider: entry.provider, logicalName: entry.logicalName },
      });
      const action = this.act(!!existing, strategy, report.sections.resourceMappings);
      if (action === 'skip' || dryRun) continue;
      const values = (entry.values ?? {}) as Prisma.InputJsonValue;
      if (action === 'create') {
        await this.prisma.resourceMapping.create({
          data: { provider: entry.provider, logicalName: entry.logicalName, values },
        });
      } else if (existing) {
        await this.prisma.resourceMapping.update({ where: { id: existing.id }, data: { values } });
      }
    }
  }

  private async importMonitors(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.monitors ?? []) {
      const existing = await this.prisma.monitor.findUnique({ where: { token: entry.token } });
      const action = this.act(!!existing, strategy, report.sections.monitors);
      if (action === 'skip') continue;

      // Résolu même en dry-run : c'est une lecture, et la prévisualisation doit
      // annoncer les liens qui ne se rétabliront pas.
      const workflowId = await this.resolveWorkflowId(entry.workflowRef, entry.name, report);
      const { config, enabled } = await this.resolveMonitorConfig(entry, report);
      if (dryRun) continue;
      const data = {
        name: entry.name,
        kind: entry.kind,
        kumaPushUrl: entry.kumaPushUrl,
        config: (config ?? undefined) as Prisma.InputJsonValue | undefined,
        enabled,
        workflowId,
      };
      if (action === 'create') {
        await this.prisma.monitor.create({ data: { ...data, token: entry.token } });
      } else if (existing) {
        await this.prisma.monitor.update({ where: { id: existing.id }, data });
      }
    }
  }

  /**
   * Retraduit `config.instanceId` (uuid de la source) en uuid local via l'URL d'instance.
   *
   * Si la traduction échoue, le monitor est importé **désactivé** et sans instanceId : le laisser
   * actif avec un id étranger le ferait pousser « instance introuvable » toutes les deux minutes —
   * et sur la sonde de la plateforme d'origine, puisque `kumaPushUrl` est recopié tel quel.
   * Le retirer du bundle serait pire : on perdrait la trace de ce qu'il reste à reconfigurer.
   */
  private async resolveMonitorConfig(
    entry: MonitorEntry,
    report: ImportReport,
  ): Promise<{ config: Record<string, unknown> | null; enabled: boolean }> {
    const sourceInstanceId = monitorInstanceId(entry.config);
    if (!sourceInstanceId) return { config: entry.config, enabled: entry.enabled };

    const localInstanceId = entry.instanceRef ? await this.refs.instanceId(entry.instanceRef) : null;
    if (localInstanceId) {
      return { config: withInstanceId(entry.config, localInstanceId), enabled: entry.enabled };
    }

    const cause = entry.instanceRef
      ? `instance ${entry.instanceRef} absente de cette plateforme`
      : "bundle antérieur à l'ajout de instanceRef";
    report.warnings.push(
      `Monitor "${entry.name}" : instance non résolue (${cause}) — importé désactivé, à réactiver après avoir choisi son instance`,
    );
    const { instanceId: _dropped, ...rest } = entry.config ?? {};
    return { config: rest, enabled: false };
  }

  private async resolveWorkflowId(
    ref: WorkflowRef | null,
    monitorName: string,
    report: ImportReport,
  ): Promise<string | null> {
    if (!ref) return null;
    const workflowId = await this.refs.workflowId(ref);
    if (!workflowId) report.warnings.push(WorkflowRefResolver.missing(`Monitor "${monitorName}"`, ref));
    return workflowId;
  }

  private async importMonitoringSettings(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.monitoringSettings ?? []) {
      const existing = await this.prisma.monitoringSettings.findUnique({ where: { id: entry.id } });
      const action = this.act(!!existing, strategy, report.sections.monitoringSettings);
      if (action === 'skip') continue;
      if (action === 'create' && entry.kumaPassword === null && (entry.kumaUsername || entry.kumaUrl)) {
        report.warnings.push(
          'Réglages Uptime Kuma importés sans mot de passe (export sans secrets) : à renseigner manuellement',
        );
      }
      if (dryRun) continue;
      if (action === 'create') {
        await this.prisma.monitoringSettings.create({
          data: {
            id: entry.id,
            kumaUrl: entry.kumaUrl,
            kumaUsername: entry.kumaUsername,
            kumaPassword: entry.kumaPassword,
          },
        });
      } else if (existing) {
        // kumaPassword null = secrets exclus de l'export → on garde le mot de passe local.
        await this.prisma.monitoringSettings.update({
          where: { id: existing.id },
          data: {
            kumaUrl: entry.kumaUrl,
            kumaUsername: entry.kumaUsername,
            ...(entry.kumaPassword !== null ? { kumaPassword: entry.kumaPassword } : {}),
          },
        });
      }
    }
  }

  private async importAiSettings(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.aiSettings ?? []) {
      const existing = await this.prisma.aiSettings.findUnique({ where: { id: entry.id } });
      const action = this.act(!!existing, strategy, report.sections.aiSettings);
      if (action === 'skip') continue;
      if (action === 'create' && entry.apiKey === null) {
        report.warnings.push(
          'Réglages IA importés sans clé API (export sans secrets) : à renseigner manuellement',
        );
      }
      if (dryRun) continue;
      // Un bundle d'avant le choix de fournisseur n'en désigne aucun : la ligne
      // reste servie si elle l'était déjà, plutôt que d'être éteinte en silence.
      const active = entry.active ?? existing?.active ?? false;
      if (action === 'create') {
        await this.prisma.aiSettings.create({
          data: { id: entry.id, model: entry.model, apiKey: entry.apiKey, active },
        });
      } else if (existing) {
        // apiKey null = secrets exclus de l'export → on garde la clé locale.
        await this.prisma.aiSettings.update({
          where: { id: existing.id },
          data: { model: entry.model, active, ...(entry.apiKey !== null ? { apiKey: entry.apiKey } : {}) },
        });
      }
    }
  }

  private async importPlatformSettings(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    for (const entry of bundle.platformSettings ?? []) {
      const existing = await this.prisma.platformSettings.findUnique({ where: { id: entry.id } });
      const action = this.act(!!existing, strategy, report.sections.platformSettings);
      if (action === 'skip' || dryRun) continue;
      const envs = entry.envs ? normalizeEnvs(entry.envs) : undefined;
      const data = {
        includeArchived: entry.includeArchived,
        ...(envs ? { envs: envs as unknown as Prisma.InputJsonValue, envChain: envIds(envs) } : {}),
        ...(entry.envChainMode ? { envChainMode: entry.envChainMode } : {}),
      };
      await this.prisma.platformSettings.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...data },
        update: data,
      });
    }
  }

  private async importModuleStates(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
  ): Promise<void> {
    const coreIds = new Set(
      this.registry
        .listManifests()
        .filter((m) => m.core)
        .map((m) => m.id),
    );
    for (const entry of bundle.moduleStates ?? []) {
      const existing = await this.prisma.moduleState.findUnique({ where: { id: entry.id } });
      const action = this.act(!!existing, strategy, report.sections.moduleStates);
      if (action === 'skip' || dryRun) continue;

      const isCore = coreIds.has(entry.id);
      const currentEnabled = await this.registry.isEnabled(entry.id);
      const settings = (entry.settings ?? undefined) as Prisma.InputJsonValue | undefined;
      await this.prisma.moduleState.upsert({
        where: { id: entry.id },
        create: { id: entry.id, enabled: currentEnabled, settings },
        update: { settings },
      });
      // Le flag enabled passe par le registre (cache mémoire + événement) ;
      // un module core reste toujours activé, quoi que dise le bundle.
      const targetEnabled = isCore ? true : entry.enabled;
      if (!isCore && targetEnabled !== currentEnabled) {
        await this.registry.setEnabled(entry.id, targetEnabled);
      }
    }
  }
}
