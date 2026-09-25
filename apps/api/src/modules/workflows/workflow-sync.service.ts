import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EVENTS,
  InstanceSyncedEvent,
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  N8nWorkflow,
  WorkflowSyncedEvent,
  hashContent,
  hashWorkflow,
  isN8nNotFound,
  isPlatformNotFound,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { InstancesService } from '../instances/instances.service';
import { TimeSavedService } from './time-saved.service';

/** Résultat d'une synchronisation d'instance. */
export interface SyncReport {
  /** Workflows renvoyés par `GET /workflows`. */
  synced: number;
  /** Workflows dont le contenu a changé depuis la dernière synchro. */
  changed: number;
  /** Workflows absents de la liste mais retrouvés à l'unité (archivés nativement dans n8n). */
  recovered: number;
  /** Workflows que n8n ne connaît plus du tout (404) : marqués, jamais supprimés. */
  missing: number;
}

/** Résultat d'une resynchronisation à l'unité. */
export interface WorkflowSyncReport {
  name: string;
  /** Le contenu a changé depuis la dernière copie locale. */
  changed: boolean;
  /** n8n ne connaît plus ce workflow (404) : marqué, jamais supprimé. */
  missing: boolean;
}

/** Synchronise les workflows d'une instance n8n vers la DB locale et émet workflow.synced. */
@Injectable()
export class WorkflowSyncService {
  private readonly logger = new Logger(WorkflowSyncService.name);
  /**
   * Le `changedAt` de la dernière lecture, par workflow. En mémoire et non en
   * base : c'est une optimisation d'appels, pas une donnée. Un redémarrage la
   * perd et la passe suivante retélécharge tout une fois — le contraire (une
   * colonne de plus, migrée, sauvegardée) coûterait plus cher que ce qu'elle
   * fait gagner.
   */
  private readonly lastChangedAt = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly instances: InstancesService,
    private readonly timeSaved: TimeSavedService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  async syncInstance(instanceId: string): Promise<SyncReport> {
    const { platform } = await this.instances.getPlatformConfig(instanceId);
    if (platform !== 'n8n') return this.syncPlatformInstance(instanceId);
    const config = await this.instances.getConfig(instanceId);
    const workflows = await this.n8n.listWorkflows(config);
    let changed = 0;

    for (const raw of workflows) {
      const result = await this.upsertWorkflow(instanceId, raw);
      if (result.hashChanged) changed += 1;
    }
    const { recovered, missing } = await this.reconcileAbsent(
      instanceId,
      config,
      new Set(workflows.map((raw) => String(raw.id))),
    );
    this.logger.log(
      `Instance ${instanceId} : ${workflows.length} workflows synchronisés (${changed} modifiés), ` +
        `${recovered} rattrapés hors liste, ${missing} absents de n8n`,
    );
    this.emitInstanceSynced(instanceId, 'instance');
    return { synced: workflows.length, changed, recovered, missing };
  }

  /**
   * Un workflow, resynchronisé par le port commun. Deux appels chez Make (le
   * scénario puis son blueprint) et aucune ruse de fraîcheur : quand un humain
   * clique « Synchroniser », c'est justement qu'il doute de ce qu'on affiche.
   */
  private async syncPlatformWorkflow(
    id: string,
    instanceId: string,
    externalId: string,
    knownName: string,
  ): Promise<WorkflowSyncReport> {
    const { platform, port, config } = await this.instances.getPlatformConfig(instanceId);
    let fetched;
    try {
      fetched = await port.getWorkflow(config, externalId);
    } catch (error) {
      if (!isPlatformNotFound(error)) throw error;
      await this.prisma.workflow.updateMany({
        where: { id, missingUpstreamAt: null },
        data: { missingUpstreamAt: new Date() },
      });
      this.logger.log(`Workflow ${externalId} ("${knownName}") absent de ${platform} : marqué`);
      this.emitInstanceSynced(instanceId, 'workflow');
      return { name: knownName, changed: false, missing: true };
    }

    const hash = hashContent(fetched.raw);
    const existing = await this.prisma.workflow.findUnique({ where: { id }, select: { hash: true } });
    const hashChanged = existing?.hash !== hash;
    await this.prisma.workflow.update({
      where: { id },
      data: {
        name: fetched.name,
        active: fetched.active,
        archivedUpstream: fetched.archivedUpstream,
        tags: fetched.tags,
        hash,
        raw: fetched.raw as object,
        missingUpstreamAt: null,
      },
    });
    if (fetched.changedAt) this.lastChangedAt.set(id, fetched.changedAt);
    this.eventBus.emit(EVENTS.workflowSynced, {
      workflowId: id,
      instanceId,
      externalId,
      name: fetched.name,
      hash,
      hashChanged,
      platform,
      raw: fetched.raw,
    } satisfies WorkflowSyncedEvent);
    this.emitInstanceSynced(instanceId, 'workflow');
    return { name: fetched.name, changed: hashChanged, missing: false };
  }

  /**
   * La synchro des plateformes SERVIES PAR LE PORT COMMUN — Make aujourd'hui.
   *
   * Elle n'a pas la même forme que celle de n8n, et c'est voulu : n8n rend le
   * contenu avec la liste, Make demande un appel par scénario sous un plafond de
   * 30 appels par minute. On ne redemande donc un blueprint que si `changedAt`
   * (le `lastEdit` du scénario) a bougé, ou si on n'a encore rien de lui — sans
   * quoi une passe coûterait un appel par scénario, à chaque heure, pour ne rien
   * apprendre.
   *
   * Ce que cette passe NE fait pas, et qui est assumé : elle n'estime pas le
   * temps gagné (le calcul lit des nœuds n8n) et elle ne rattrape pas les
   * workflows absents de la liste à l'unité — chez Make, un scénario hors liste
   * est à la corbeille, et l'y redemander coûterait un appel pour un 404 certain.
   */
  private async syncPlatformInstance(instanceId: string): Promise<SyncReport> {
    const { platform, port, config } = await this.instances.getPlatformConfig(instanceId);
    const summaries = await port.listWorkflows(config);
    const locals = await this.prisma.workflow.findMany({
      where: { instanceId },
      select: { id: true, externalId: true, hash: true, raw: true },
    });
    const byExternalId = new Map(locals.map((local) => [local.externalId, local]));
    const seen = new Set<string>();
    let changed = 0;

    for (const summary of summaries) {
      seen.add(summary.externalId);
      const local = byExternalId.get(summary.externalId);
      const known = local ? this.lastChangedAt.get(local.id) : undefined;
      const contentIsFresh = Boolean(local) && known !== undefined && known === summary.changedAt;

      const raw = contentIsFresh ? local!.raw : (await port.getWorkflow(config, summary.externalId)).raw;

      const hash = hashContent(raw);
      const hashChanged = local?.hash !== hash;
      const workflow = await this.prisma.workflow.upsert({
        where: { instanceId_externalId: { instanceId, externalId: summary.externalId } },
        create: {
          instanceId,
          externalId: summary.externalId,
          name: summary.name,
          active: summary.active,
          archivedUpstream: summary.archivedUpstream,
          tags: summary.tags,
          hash,
          raw: raw as object,
          upstreamUpdatedAt: parseDate(summary.changedAt),
        },
        update: {
          name: summary.name,
          active: summary.active,
          archivedUpstream: summary.archivedUpstream,
          tags: summary.tags,
          hash,
          raw: raw as object,
          missingUpstreamAt: null,
          upstreamUpdatedAt: parseDate(summary.changedAt),
        },
      });
      if (summary.changedAt) this.lastChangedAt.set(workflow.id, summary.changedAt);
      if (hashChanged) changed += 1;
      this.eventBus.emit(EVENTS.workflowSynced, {
        workflowId: workflow.id,
        instanceId,
        externalId: summary.externalId,
        name: summary.name,
        hash,
        hashChanged,
        platform,
        raw,
      } satisfies WorkflowSyncedEvent);
    }

    let missing = 0;
    for (const local of locals) {
      if (seen.has(local.externalId)) continue;
      missing += 1;
      await this.prisma.workflow.updateMany({
        where: { id: local.id, missingUpstreamAt: null },
        data: { missingUpstreamAt: new Date() },
      });
    }

    this.logger.log(
      `Instance ${instanceId} (${platform}) : ${summaries.length} workflows synchronisés ` +
        `(${changed} modifiés), ${missing} absents`,
    );
    this.emitInstanceSynced(instanceId, 'instance');
    return { synced: summaries.length, changed, recovered: 0, missing };
  }

  /**
   * Resynchronise UN workflow depuis n8n : la copie locale peut dater d'une
   * heure (cron) ou de la dernière synchro d'instance, alors qu'on s'apprête à
   * la lire — bouton « Synchroniser » de la page workflow, ou juste avant un
   * test, qui n'a aucun intérêt à juger une version périmée.
   */
  async syncWorkflow(workflowId: string): Promise<WorkflowSyncReport> {
    const local = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!local) throw new NotFoundException(`Workflow ${workflowId} introuvable`);
    const { platform } = await this.instances.getPlatformConfig(local.instanceId);
    if (platform !== 'n8n')
      return this.syncPlatformWorkflow(local.id, local.instanceId, local.externalId, local.name);
    const config = await this.instances.getConfig(local.instanceId);

    try {
      const raw = await this.n8n.getWorkflow(config, local.externalId);
      const event = await this.upsertWorkflow(local.instanceId, raw);
      this.emitInstanceSynced(local.instanceId, 'workflow');
      return { name: raw.name, changed: event.hashChanged, missing: false };
    } catch (error) {
      if (!isN8nNotFound(error)) throw error;
      if (!local.missingUpstreamAt) {
        await this.prisma.workflow.update({
          where: { id: local.id },
          data: { missingUpstreamAt: new Date() },
        });
      }
      this.logger.log(`Workflow ${local.externalId} ("${local.name}") absent de n8n : marqué`);
      this.emitInstanceSynced(local.instanceId, 'workflow');
      return { name: local.name, changed: false, missing: true };
    }
  }

  /**
   * Fin de passe : ce que la synchro vient d'apprendre sur l'ÉTAT des workflows
   * (archivé dans n8n, disparu de n8n) n'est lisible qu'en fin de course, et un
   * workflow supprimé n'émet aucun `workflow.synced` puisqu'il n'y a plus rien à
   * copier. Les abonnés repartent donc de la base plutôt que du payload.
   */
  private emitInstanceSynced(instanceId: string, scope: InstanceSyncedEvent['scope']): void {
    this.eventBus.emit(EVENTS.instanceSynced, { instanceId, scope } satisfies InstanceSyncedEvent);
  }

  /**
   * Sort du silence les workflows que la liste n8n n'a pas renvoyés — un workflow
   * supprimé côté n8n, sinon, reste affiché comme un workflow ordinaire pour
   * toujours : rien ne vient jamais contredire la dernière copie connue.
   *
   * On les redemande donc un par un : une réponse ⇒ on remet la copie à jour
   * (c'est aussi le filet si une version de n8n retire les archivés de sa liste),
   * un 404 ⇒ n8n ne le connaît plus, on l'estampille `missingUpstreamAt` sans jamais
   * rien supprimer. Aucun appel supplémentaire quand la liste est complète.
   */
  private async reconcileAbsent(
    instanceId: string,
    config: N8nInstanceConfig,
    listed: Set<string>,
  ): Promise<{ recovered: number; missing: number }> {
    const locals = await this.prisma.workflow.findMany({
      where: { instanceId },
      select: { id: true, externalId: true, name: true, missingUpstreamAt: true },
    });
    let recovered = 0;
    let missing = 0;

    for (const local of locals) {
      if (listed.has(local.externalId)) continue;
      try {
        await this.upsertWorkflow(instanceId, await this.n8n.getWorkflow(config, local.externalId));
        recovered += 1;
      } catch (error) {
        if (!isN8nNotFound(error)) {
          this.logger.warn(
            `Workflow ${local.externalId} ("${local.name}") illisible : ${(error as Error).message}`,
          );
          continue;
        }
        missing += 1;
        if (local.missingUpstreamAt) continue;
        await this.prisma.workflow.update({
          where: { id: local.id },
          data: { missingUpstreamAt: new Date() },
        });
        this.logger.log(`Workflow ${local.externalId} ("${local.name}") absent de n8n : marqué`);
      }
    }
    return { recovered, missing };
  }

  async upsertWorkflow(instanceId: string, raw: N8nWorkflow): Promise<WorkflowSyncedEvent> {
    const hash = hashWorkflow(raw);
    const tags = (raw.tags ?? []).map((t) => (typeof t === 'string' ? t : t.name));
    const existing = await this.prisma.workflow.findUnique({
      where: { instanceId_externalId: { instanceId, externalId: String(raw.id) } },
    });
    const hashChanged = existing?.hash !== hash;
    // L'estimation du temps gagné se relit du contenu : on la refait quand le
    // contenu bouge (une estimation affinée à l'IA décrit alors un workflow qui
    // n'existe plus) et quand elle manque. Contenu inchangé ⇒ on n'y touche pas.
    const timeSaved =
      hashChanged || existing?.minutesSavedEstimate == null ? this.timeSaved.estimateFields(raw) : {};

    const workflow = await this.prisma.workflow.upsert({
      where: { instanceId_externalId: { instanceId, externalId: String(raw.id) } },
      create: {
        instanceId,
        externalId: String(raw.id),
        name: raw.name,
        active: raw.active ?? false,
        archivedUpstream: raw.isArchived === true,
        tags,
        hash,
        raw: raw as unknown as object,
        upstreamUpdatedAt: parseDate(raw.updatedAt),
        ...this.timeSaved.estimateFields(raw),
      },
      update: {
        name: raw.name,
        active: raw.active ?? false,
        archivedUpstream: raw.isArchived === true,
        tags,
        hash,
        raw: raw as unknown as object,
        missingUpstreamAt: null,
        upstreamUpdatedAt: parseDate(raw.updatedAt),
        ...timeSaved,
      },
    });

    const event: WorkflowSyncedEvent = {
      workflowId: workflow.id,
      instanceId,
      externalId: String(raw.id),
      name: raw.name,
      hash,
      hashChanged,
      platform: 'n8n',
      raw,
    };
    this.eventBus.emit(EVENTS.workflowSynced, event);
    return event;
  }
}

/** Date ISO rendue par la plateforme ; absente ou illisible ⇒ null plutôt qu'une date invalide en base. */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
