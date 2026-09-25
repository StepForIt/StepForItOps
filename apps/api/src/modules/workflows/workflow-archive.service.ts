import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ARCHIVED_TAG,
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  N8nWorkflow,
  withArchivedPrefix,
  withoutArchivedPrefix,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { InstancesService } from '../instances/instances.service';
import { WorkflowSyncService } from './workflow-sync.service';
import { WorkflowWithEnv, WorkflowsService } from './workflows.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/**
 * Archivage « doux » d'un workflow : pas d'archivage réel côté n8n,
 * on ajoute le tag `archived` et on préfixe le nom (`[ARCHIVED] `).
 * Le workflow reste intact dans n8n ; la plateforme le masque par défaut.
 */
@Injectable()
export class WorkflowArchiveService {
  private readonly logger = new Logger(WorkflowArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: InstancesService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  archive(id: string): Promise<WorkflowWithEnv> {
    return this.apply(id, true);
  }

  unarchive(id: string): Promise<WorkflowWithEnv> {
    return this.apply(id, false);
  }

  private async apply(id: string, archived: boolean): Promise<WorkflowWithEnv> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow) throw new NotFoundException(`Workflow ${id} introuvable`);
    await this.locks.assertWritable(id);
    const config = await this.instances.getConfig(workflow.instanceId);

    const raw = await this.n8n.getWorkflow(config, workflow.externalId);
    if (raw.isArchived) {
      throw new BadRequestException(
        `« ${raw.name} » est archivé nativement côté n8n : il n'est plus modifiable via l'API. Désarchivez-le d'abord dans n8n.`,
      );
    }
    const newName = archived ? withArchivedPrefix(raw.name) : withoutArchivedPrefix(raw.name);
    if (newName !== raw.name) {
      await this.n8n.updateWorkflow(config, workflow.externalId, { ...raw, name: newName });
    }
    await this.setArchivedTag(config, workflow.externalId, raw, archived);

    // Resynchronise le miroir local (émet workflow.synced → snapshot versioning, etc.)
    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);
    this.logger.log(`Workflow ${workflow.externalId} ${archived ? 'archivé' : 'désarchivé'} (tag + préfixe)`);
    return this.workflows.get(id);
  }

  /** Recompose la liste des tags du workflow avec/sans `archived` (l'API n8n remplace la liste entière). */
  private async setArchivedTag(
    config: N8nInstanceConfig,
    externalId: string,
    raw: N8nWorkflow,
    archived: boolean,
  ): Promise<void> {
    const currentNames = (raw.tags ?? []).map((t) => (typeof t === 'string' ? t : t.name));
    const hasTag = currentNames.some((name) => name.toLowerCase() === ARCHIVED_TAG);
    if (archived === hasTag) return;
    const wantedNames = archived
      ? [...currentNames, ARCHIVED_TAG]
      : currentNames.filter((name) => name.toLowerCase() !== ARCHIVED_TAG);

    const allTags = await this.n8n.listTags(config);
    const idByName = new Map(allTags.map((t) => [t.name, t.id]));
    if (archived && !idByName.has(ARCHIVED_TAG)) {
      const created = await this.n8n.createTag(config, ARCHIVED_TAG);
      idByName.set(created.name, created.id);
    }
    const tagIds = wantedNames
      .map((name) => idByName.get(name))
      .filter((tagId): tagId is string => Boolean(tagId));
    await this.n8n.setWorkflowTags(config, externalId, tagIds);
  }
}
