import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, VersionCreatedEvent, WorkflowSyncedEvent } from '@nwm/core';
import { WorkflowVersion } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { PrismaListArgs } from '../../common/crud/paginate';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { InstancesService } from '../instances/instances.service';
import { VERSIONING_MANIFEST } from './manifest';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

@Injectable()
export class VersioningService {
  private readonly logger = new Logger(VersioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly registry: ModuleRegistryService,
    private readonly instances: InstancesService,
    private readonly settings: PlatformSettingsService,
    private readonly envChain: EnvChainGuardService,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Hook : à chaque sync, snapshot si le contenu a changé. */
  @OnEvent(EVENTS.workflowSynced)
  async onWorkflowSynced(event: WorkflowSyncedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(VERSIONING_MANIFEST.id))) return;
    if (!event.hashChanged) return;
    await this.createVersion(event.workflowId, event.raw, event.hash, 'sync');
  }

  async createVersion(
    workflowId: string,
    /**
     * Le contenu, quelle que soit la plateforme : on le STOCKE, on ne le lit
     * pas. C'est ce qui permet de sauvegarder un blueprint Make par le même
     * chemin qu'un workflow n8n.
     */
    raw: unknown,
    hash: string,
    origin: string,
    message?: string,
  ): Promise<WorkflowVersion> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    const version = await this.prisma.workflowVersion.create({
      data: { workflowId, hash, raw: raw as unknown as object, origin, message },
    });
    const event: VersionCreatedEvent = {
      versionId: version.id,
      workflowId,
      instanceId: workflow.instanceId,
      workflowName: workflow.name,
      hash,
    };
    this.eventBus.emit(EVENTS.versionCreated, event);
    this.logger.log(`Version ${version.id} créée pour "${workflow.name}" (${origin})`);
    return version;
  }

  async listVersions(
    workflowId?: string,
    instanceId?: string,
    args: PrismaListArgs = {},
  ): Promise<{ data: WorkflowVersion[]; total: number }> {
    const where = {
      ...(workflowId ? { workflowId } : {}),
      // Versions des workflows archivés masquées comme les workflows eux-mêmes
      workflow: { ...(instanceId ? { instanceId } : {}), ...(await this.settings.workflowFilter()) },
    };
    const [data, total] = await Promise.all([
      this.prisma.workflowVersion.findMany({
        where,
        orderBy: args.orderBy ?? { createdAt: 'desc' },
        skip: args.skip,
        take: args.take ?? 200,
        include: { workflow: { select: { name: true, instanceId: true } } },
      }),
      this.prisma.workflowVersion.count({ where }),
    ]);
    return { data, total };
  }

  async getVersion(id: string): Promise<WorkflowVersion> {
    const version = await this.prisma.workflowVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Version ${id} introuvable`);
    return version;
  }

  /**
   * Réécrit le contenu d'une version sur sa plateforme, puis re-snapshote.
   *
   * Par le port de la plateforme du workflow : la version porte un JSON n8n ou un
   * blueprint Make selon d'où elle vient, et c'est l'adapter qui sait l'écrire.
   * Chez Make, c'est même le seul chemin qui reste au-delà de 60 jours, quand
   * Make ne garde plus l'ancien blueprint.
   */
  async restore(versionId: string): Promise<{ ok: boolean }> {
    const version = await this.getVersion(versionId);
    // Restaurer, c'est réécrire : en mode bloquant, un env aval ne reçoit que ce
    // qu'on y promeut — y compris quand ce qu'on y remet vient de son propre passé.
    await this.envChain.assertDirectWriteAllowed(version.workflowId);
    await this.locks.assertWritable(version.workflowId);
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: version.workflowId } });
    const { port, config } = await this.instances.getPlatformConfig(workflow.instanceId);
    await port.updateWorkflow(config, workflow.externalId, version.raw);
    await this.createVersion(workflow.id, version.raw, version.hash, 'restore', `Restore de ${versionId}`);
    return { ok: true };
  }
}
