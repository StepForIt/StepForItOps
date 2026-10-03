import { Injectable, Logger } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { ConfigBundle, ImportReport, WorkflowRef } from './config-bundle.types';
import { WorkflowRefResolver } from './workflow-ref.resolver';

/** Toutes les références à un workflow que porte le bundle. */
function bundleWorkflowRefs(bundle: ConfigBundle): WorkflowRef[] {
  const refs: WorkflowRef[] = [];
  for (const m of bundle.monitors ?? []) if (m.workflowRef) refs.push(m.workflowRef);
  for (const f of bundle.findingIgnores ?? []) {
    if (f.workflowRef) refs.push(f.workflowRef);
    if (f.familyWorkflowRef) refs.push(f.familyWorkflowRef);
  }
  for (const g of bundle.workflowGroups ?? []) {
    for (const externalId of g.workflowN8nIds) refs.push({ instanceBaseUrl: g.instanceBaseUrl, externalId });
  }
  for (const l of bundle.workflowLinks ?? []) refs.push(l.from, l.to);
  return refs;
}

/**
 * Synchronise, au milieu de l'import, les instances dont le bundle vise des
 * workflows encore absents du miroir. Sans elle, une base vierge demandait
 * d'importer, synchroniser à la main, puis ré-importer le même fichier.
 * Seules ces instances-là sont synchronisées : les autres le seront par le cron.
 */
@Injectable()
export class ConfigImportSyncService {
  private readonly logger = new Logger(ConfigImportSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: WorkflowSyncService,
    private readonly refs: WorkflowRefResolver,
  ) {}

  async syncReferenced(bundle: ConfigBundle, dryRun: boolean, report: ImportReport): Promise<void> {
    const toSync = new Set<string>();
    for (const ref of bundleWorkflowRefs(bundle)) {
      if (!(await this.refs.workflowId(ref))) toSync.add(ref.instanceBaseUrl);
    }

    for (const baseUrl of toSync) {
      const local = await this.prisma.instance.findFirst({ where: { baseUrl } });
      const entry = (bundle.instances ?? []).find((i) => i.baseUrl === baseUrl);
      const name = local?.name ?? entry?.name ?? baseUrl;

      if (dryRun) {
        // Le bundle dit ce que la base serait : instance créée, clé importée ou gardée.
        if (!(entry?.apiKey || local?.apiKey)) continue;
        this.refs.planSync(baseUrl);
        report.syncs.push({ instance: name, synced: null });
        continue;
      }
      if (!local?.apiKey) continue;
      try {
        const result = await this.sync.syncInstance(local.id);
        report.syncs.push({ instance: name, synced: result.synced });
      } catch (error) {
        this.logger.warn(`Import: sync of ${baseUrl} failed: ${(error as Error).message}`);
        report.warnings.push(msg('platform.importSyncFailed', { name, error: (error as Error).message }));
      }
    }
    // Les workflows tout juste synchronisés doivent être relus.
    if (!dryRun && toSync.size > 0) this.refs.reset();
  }
}
