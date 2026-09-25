import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  PathConflictReport,
  PathFix,
  detectWorkflowEnv,
  envIds,
  findPathConflicts,
  withDeclaredEntryPath,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

export interface AppliedPathFix extends PathFix {
  applied: boolean;
  error?: string;
}

/**
 * Rattrapage des copies d'env créées AVANT que la duplication ne donne son propre
 * path à chacune : elles partagent celui de leur original, donc n8n les ignore et
 * sert le gardien du path à leur place.
 *
 * Le plan se relit avant d'être appliqué : rien n'est corrigé d'office. Réécrire
 * un path est un changement d'URL, et une URL qu'on déplace est un appelant qu'on
 * casse — c'est bien pour ça que le gardien, lui, n'est jamais touché.
 */
@Injectable()
export class WebhookPathFixService {
  private readonly logger = new Logger(WebhookPathFixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly settings: PlatformSettingsService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Les paths disputés d'une instance, avec ce qu'il faudrait écrire. */
  async plan(instanceId: string): Promise<PathConflictReport> {
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, ...(await this.settings.workflowFilter()) },
      select: { id: true, name: true, active: true, tags: true, raw: true },
    });
    const envs = await this.settings.declaredEnvs();
    return findPathConflicts(
      workflows.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        env: detectWorkflowEnv(w.name, w.tags, envIds(envs)),
        raw: w.raw as unknown as N8nWorkflow,
      })),
      envs,
    );
  }

  /**
   * Applique les corrections demandées, une par une. Chaque écriture est vérifiée
   * contre le plan courant : un plan périmé (le workflow a bougé dans n8n entre-temps)
   * ne doit pas écrire un path calculé sur un état qui n'existe plus.
   */
  async apply(instanceId: string, workflowIds: string[]): Promise<{ results: AppliedPathFix[] }> {
    if (workflowIds.length === 0) throw new BadRequestException('Aucun workflow à corriger.');
    const { fixes } = await this.plan(instanceId);
    const retained = fixes.filter((fix) => workflowIds.includes(fix.workflowId));
    const unknown = workflowIds.filter((id) => !retained.some((fix) => fix.workflowId === id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `${unknown.length} workflow(s) ne sont plus dans le plan (état changé dans n8n ?) : relis le plan avant d'appliquer.`,
      );
    }

    await this.locks.assertWritable(retained.map((fix) => fix.workflowId));
    const config = await this.instances.getConfig(instanceId);
    const results: AppliedPathFix[] = [];
    for (const fix of retained) {
      try {
        const local = await this.prisma.workflow.findUniqueOrThrow({
          where: { id: fix.workflowId },
          select: { externalId: true },
        });
        // Relu dans n8n : le miroir local ne se resynchronise qu'à l'heure, et on
        // s'apprête à réécrire le workflow entier.
        const live = await this.n8n.getWorkflow(config, local.externalId);
        const nodes = live.nodes.map((node) =>
          node.name === fix.node ? withDeclaredEntryPath(node, fix.to) : node,
        );
        await this.n8n.updateWorkflow(config, local.externalId, { ...live, nodes });
        const fresh = await this.n8n.getWorkflow(config, local.externalId);
        await this.sync.upsertWorkflow(instanceId, fresh);
        results.push({ ...fix, applied: true });
        this.logger.log(`« ${fix.workflowName} » : path /${fix.from} → /${fix.to}`);
      } catch (error) {
        results.push({ ...fix, applied: false, error: (error as Error).message });
        this.logger.warn(`Path KO sur « ${fix.workflowName} » : ${(error as Error).message}`);
      }
    }
    return { results };
  }
}
