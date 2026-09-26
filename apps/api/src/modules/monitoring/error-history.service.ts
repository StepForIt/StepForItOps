import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import {
  EVENTS,
  MonitorErroredExecution,
  MonitorErrorsDetectedEvent,
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  detectWorkflowEnv,
  envIds,
  isMonitoredEnv,
  parseExecutionError,
  PlatformId,
  WorkflowPlatformPorts,
  WORKFLOW_PLATFORM_PORTS,
  msg,
} from '@nwm/core';
import { ExecutionError } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { MONITORING_MANIFEST } from './manifest';
import { ErrorGroupService } from './error-group.service';

/** Détails récupérés d'office à l'ingestion temps réel (au-delà : à la demande depuis l'UI). */
const EAGER_DETAIL_LIMIT = 25;
/** Garde-fou du backfill : pages de 100 exécutions en erreur. */
const BACKFILL_MAX_PAGES = 20;
const BACKFILL_PAGE_SIZE = 100;
/** Rétention de notre historique local (n8n purge le sien bien plus tôt). */
const RETENTION_DAYS = 365;
/** Appels parallèles à l'API n8n lors d'un rattrapage en masse. */
const DETAIL_CONCURRENCY = 4;

export interface BackfillResult {
  scanned: number;
  imported: number;
  alreadyKnown: number;
  oldest?: string;
}

export interface PendingDetailsResult {
  processed: number;
  fetched: number;
  unavailable: number;
  /** Détails encore manquants après ce passage (lot limité). */
  remaining?: number;
}

/**
 * Historise les exécutions en erreur : ingestion depuis le monitor `error-watch`,
 * backfill de l'historique n8n, et récupération du détail « quel nœud a fail ».
 * Prod uniquement, comme le poll : le backfill applique la règle lui-même, l'ingestion
 * la reçoit déjà appliquée.
 */
@Injectable()
export class ErrorHistoryService {
  private readonly logger = new Logger(ErrorHistoryService.name);
  /** Un seul drainage à la fois : un lot lent ne doit pas s'empiler sur le suivant. */
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly groups: ErrorGroupService,
    @Inject(N8N_API_PORT) private readonly n8nApi: N8nApiPort,
    @Inject(WORKFLOW_PLATFORM_PORTS) private readonly platforms: WorkflowPlatformPorts,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Ingestion temps réel : le monitor error-watch vient de voir de nouvelles erreurs. */
  @OnEvent(EVENTS.monitorErrorsDetected)
  async onErrorsDetected(event: MonitorErrorsDetectedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(MONITORING_MANIFEST.id))) return;
    try {
      const rows: ExecutionError[] = [];
      for (const workflow of event.workflows) {
        for (const execution of workflow.executions) {
          const row = await this.upsert(event.instanceId, workflow.externalId, workflow.name, execution);
          if (row) rows.push(row);
        }
      }
      // Le détail n'est disponible que tant que n8n n'a pas purgé l'exécution : on le
      // capture tout de suite, contrairement au backfill qui reste paresseux.
      for (const row of rows.slice(0, EAGER_DETAIL_LIMIT)) {
        await this.fetchDetail(row).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(`Error history ingestion failed: ${(error as Error).message}`);
    }
  }

  /** Importe les exécutions en erreur déjà présentes dans n8n (au premier usage). */
  /**
   * L'import d'historique d'une plateforme servie par le port commun.
   *
   * Il ne peut pas avoir la forme de celui de n8n, qui remonte un listing global
   * page par page jusqu'à la date de coupure : Make n'a pas ce listing. On
   * parcourt donc les scénarios, et pour chacun ses logs — un appel par
   * scénario, comme le poll.
   *
   * Deux limites, dites parce qu'elles se voient dans le résultat :
   *
   * - la profondeur ne dépend pas que de `days` mais aussi de ce que Make garde
   *   et de la taille d'une page. Un scénario très actif peut ne rendre que ses
   *   dernières exécutions, et `oldest` dit alors jusqu'où on est remonté ;
   * - un scénario ÉTEINT est quand même parcouru ici, contrairement au poll. Un
   *   import d'historique regarde le passé, où le scénario tournait peut-être.
   */
  private async backfillPlatform(
    instance: {
      id: string;
      platform: string;
      baseUrl: string;
      apiKey: string;
      zone: string | null;
      externalOrgId: string | null;
      externalTeamId: string | null;
    },
    days: number,
  ): Promise<BackfillResult> {
    const port = this.platforms[instance.platform as PlatformId];
    if (!port)
      throw new BadRequestException(msg('ops.platformNotSupported', { platform: instance.platform }));

    const config = {
      baseUrl: instance.baseUrl,
      apiKey: instance.apiKey,
      zone: instance.zone ?? undefined,
      orgId: instance.externalOrgId ?? undefined,
      teamId: instance.externalTeamId ?? undefined,
    };
    const mirrored = await this.mirroredWorkflows(instance.id);
    const envs = await this.settings.declaredEnvs();
    const ids = envIds(envs);
    const since = Date.now() - days * 24 * 3600 * 1000;
    const result: BackfillResult = { scanned: 0, imported: 0, alreadyKnown: 0 };

    for (const [externalId, workflow] of mirrored) {
      if (!isMonitoredEnv(detectWorkflowEnv(workflow.name, workflow.tags, ids), envs)) continue;

      const page = await port.listExecutions(config, {
        workflowExternalId: externalId,
        limit: BACKFILL_PAGE_SIZE,
      });
      for (const execution of page.executions) {
        if (execution.status !== 'error') continue;
        const startedAt = execution.startedAt ? new Date(execution.startedAt) : null;
        if (startedAt && startedAt.getTime() < since) continue;

        result.scanned += 1;
        result.oldest = execution.startedAt ?? result.oldest;
        const created = await this.upsert(instance.id, externalId, workflow.name, {
          id: execution.externalId,
          startedAt: execution.startedAt,
          stoppedAt: execution.stoppedAt,
        });
        if (created) result.imported += 1;
        else result.alreadyKnown += 1;
      }
    }
    return result;
  }

  async backfill(instanceId: string, days = 30): Promise<BackfillResult> {
    const instance = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundException(msg('ops.instanceNotFound', { id: instanceId }));
    if (instance.platform !== 'n8n') return this.backfillPlatform(instance, days);

    const mirrored = await this.mirroredWorkflows(instanceId);
    const envs = await this.settings.declaredEnvs();
    const since = Date.now() - days * 24 * 3600 * 1000;
    const result: BackfillResult = { scanned: 0, imported: 0, alreadyKnown: 0 };
    let cursor: string | undefined;

    for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
      const { executions, nextCursor } = await this.n8nApi.listErrorExecutions(instance, {
        limit: BACKFILL_PAGE_SIZE,
        cursor,
      });
      if (executions.length === 0) break;

      let reachedCutoff = false;
      for (const execution of executions) {
        const startedAt = execution.startedAt ? new Date(execution.startedAt) : null;
        if (startedAt && startedAt.getTime() < since) {
          reachedCutoff = true;
          break;
        }
        // Même règle que le poll : hors env surveillé, on n'historise pas (cf. ErrorWatchService).
        const workflow = mirrored.get(execution.workflowId);
        const env = workflow ? detectWorkflowEnv(workflow.name, workflow.tags, envIds(envs)) : null;
        if (!isMonitoredEnv(env, envs)) continue;
        result.scanned += 1;
        result.oldest = execution.startedAt ?? result.oldest;
        const created = await this.upsert(instanceId, execution.workflowId, workflow?.name, {
          id: execution.id,
          startedAt: execution.startedAt,
          stoppedAt: execution.stoppedAt,
          mode: execution.mode,
        });
        if (created) result.imported += 1;
        else result.alreadyKnown += 1;
      }

      if (reachedCutoff || !nextCursor) break;
      cursor = nextCursor;
    }
    return result;
  }

  /** Rattrapage en masse des détails manquants, les plus récents d'abord : ce sont ceux que n8n a encore. */
  async fetchPendingDetails(instanceId?: string, limit = 200): Promise<PendingDetailsResult> {
    const rows = await this.prisma.executionError.findMany({
      where: { detailState: 'pending', ...(instanceId ? { instanceId } : {}) },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });

    const result: PendingDetailsResult = { processed: rows.length, fetched: 0, unavailable: 0 };
    for (let index = 0; index < rows.length; index += DETAIL_CONCURRENCY) {
      const batch = rows.slice(index, index + DETAIL_CONCURRENCY);
      const updated = await Promise.all(batch.map((row) => this.fetchDetail(row).catch(() => null)));
      for (const row of updated) {
        if (row?.detailState === 'fetched') result.fetched += 1;
        else result.unavailable += 1;
      }
    }
    result.remaining = await this.prisma.executionError.count({
      where: { detailState: 'pending', ...(instanceId ? { instanceId } : {}) },
    });
    return result;
  }

  /**
   * Détail d'une erreur, récupéré depuis n8n au premier affichage puis mis en cache.
   * `unavailable` = exécution purgée côté n8n ou JSON illisible : on ne réessaie plus.
   */
  async detail(id: string): Promise<ExecutionError> {
    const row = await this.prisma.executionError.findUniqueOrThrow({ where: { id } });
    if (row.detailState !== 'pending') return row;
    return (await this.fetchDetail(row)) ?? row;
  }

  /**
   * Drainage automatique : n8n purge ses exécutions, un détail non récupéré à
   * temps est perdu — on n'attend donc pas une action humaine.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async drainPendingDetails(): Promise<void> {
    if (this.draining) return;
    if (!(await this.registry.isEnabled(MONITORING_MANIFEST.id))) return;
    this.draining = true;
    try {
      const result = await this.fetchPendingDetails();
      if (result.processed > 0) {
        this.logger.log(
          `Error details drained: ${result.fetched} fetched, ${result.unavailable} unavailable, ${result.remaining} remaining`,
        );
      }
    } catch (error) {
      this.logger.warn(`Error details drain failed: ${(error as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  /** Purge de notre propre historique (le volume reste borné dans le temps). */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async prune(): Promise<void> {
    if (!(await this.registry.isEnabled(MONITORING_MANIFEST.id))) return;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await this.prisma.executionError.deleteMany({ where: { startedAt: { lt: cutoff } } });
    if (count === 0) return;
    this.logger.log(`${count} execution error(s) purged (> ${RETENTION_DAYS} d)`);
    // Les groupes comptent des lignes qui n'existent plus : on recale (et ceux
    // qui n'ont plus aucune occurrence disparaissent avec leur journal).
    const groups = await this.prisma.errorGroup.findMany({ select: { id: true } });
    for (const group of groups) {
      await this.groups.recount(group.id).catch(() => undefined);
    }
  }

  /** Crée la ligne si l'exécution est inconnue ; renvoie null si elle était déjà historisée. */
  private async upsert(
    instanceId: string,
    externalWorkflowId: string,
    workflowName: string | undefined,
    execution: MonitorErroredExecution,
  ): Promise<ExecutionError | null> {
    const existing = await this.prisma.executionError.findUnique({
      where: { instanceId_executionId: { instanceId, executionId: execution.id } },
    });
    if (existing) return null;

    const workflow = await this.prisma.workflow.findUnique({
      where: { instanceId_externalId: { instanceId, externalId: externalWorkflowId } },
      select: { id: true, name: true },
    });
    const row = await this.prisma.executionError.create({
      data: {
        instanceId,
        executionId: execution.id,
        externalWorkflowId,
        workflowId: workflow?.id ?? null,
        workflowName: workflow?.name ?? workflowName ?? externalWorkflowId,
        startedAt: execution.startedAt ? new Date(execution.startedAt) : new Date(),
        stoppedAt: execution.stoppedAt ? new Date(execution.stoppedAt) : null,
        mode: execution.mode ?? null,
      },
    });
    // Groupée tout de suite, sur le peu qu'on sait : le détail affinera la
    // signature (et déplacera la ligne) dès qu'il arrivera.
    await this.groups.assign(row).catch((error) => {
      this.logger.warn(`Grouping failed for execution ${row.executionId}: ${(error as Error).message}`);
    });
    return row;
  }

  /**
   * Le détail d'une erreur chez une plateforme servie par le port commun.
   *
   * Make donne le message et le MODULE fautif, jamais la pile ni les données :
   * seules ses exécutions incomplètes gardent des bundles. On rend donc un
   * détail partiel plutôt que rien — c'est le message et le nœud qui font la
   * signature d'un groupe d'erreurs, et ils suffisent.
   */
  private async platformDetail(
    instance: {
      platform: string;
      baseUrl: string;
      apiKey: string;
      zone: string | null;
      externalOrgId: string | null;
      externalTeamId: string | null;
    },
    row: ExecutionError,
  ): Promise<{ message?: string; failedNode?: string; failedNodeType?: string; stack?: string }> {
    const port = this.platforms[instance.platform as PlatformId];
    if (!port) return {};
    const execution = await port.getExecution(
      {
        baseUrl: instance.baseUrl,
        apiKey: instance.apiKey,
        zone: instance.zone ?? undefined,
        orgId: instance.externalOrgId ?? undefined,
        teamId: instance.externalTeamId ?? undefined,
      },
      { workflowExternalId: row.externalWorkflowId, executionExternalId: row.executionId },
    );
    if (!execution?.error) return {};
    return {
      message: execution.error.message,
      ...(execution.error.nodeName ? { failedNode: execution.error.nodeName } : {}),
    };
  }

  private async fetchDetail(row: ExecutionError): Promise<ExecutionError | null> {
    const instance = await this.prisma.instance.findUnique({ where: { id: row.instanceId } });
    if (!instance) return null;
    try {
      const detail =
        instance.platform === 'n8n'
          ? parseExecutionError(
              await this.n8nApi.getExecution(instance as N8nInstanceConfig, row.executionId, {
                includeData: true,
              }),
            )
          : await this.platformDetail(instance, row);
      const updated = await this.prisma.executionError.update({
        where: { id: row.id },
        data: {
          detailState: detail.message || detail.failedNode ? 'fetched' : 'unavailable',
          failedNode: detail.failedNode ?? null,
          failedNodeType: detail.failedNodeType ?? null,
          message: detail.message ?? null,
          stack: detail.stack ?? null,
        },
      });
      // Le message change la signature : la ligne rejoint (ou crée) son vrai groupe.
      await this.groups.assign(updated).catch(() => undefined);
      return updated;
    } catch (error) {
      this.logger.debug(`Detail unavailable for execution ${row.executionId}: ${(error as Error).message}`);
      const updated = await this.prisma.executionError.update({
        where: { id: row.id },
        data: { detailState: 'unavailable' },
      });
      // Le détail ne viendra jamais : la ligne reste dans son groupe « (sans détail) »,
      // mais il faut le lui redire — c'est ce passage qui autorise enfin son annonce.
      await this.groups.assign(updated).catch(() => undefined);
      return updated;
    }
  }

  /** Nom et tags des workflows du miroir, pour nommer l'erreur et en déduire l'env. */
  private async mirroredWorkflows(
    instanceId: string,
  ): Promise<Map<string, { name: string; tags: string[] }>> {
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId },
      select: { externalId: true, name: true, tags: true },
    });
    return new Map(workflows.map((w) => [w.externalId, { name: w.name, tags: w.tags }]));
  }
}
