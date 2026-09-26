import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nExecutionSummary,
  PlatformId,
  WorkflowPlatformPorts,
  WORKFLOW_PLATFORM_PORTS,
  detectWorkflowEnv,
  envIds,
  executionDurationMs,
  isCheckDue,
  isMonitoredEnv,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { PERFORMANCE_MANIFEST } from './manifest';

/** Cadence du poll par instance : les stats n'ont pas besoin de la minute près. */
const POLL_INTERVAL_SECONDS = 300;
/** Pages max par poll : au-delà, le reste attend le prochain tour (rattrapage progressif). */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
/** Au-delà, les stats ne servent plus les tendances : purgées. */
const RETENTION_DAYS = 90;
/** La purge est quotidienne, pas à chaque tick. */
const PURGE_EVERY_MS = 24 * 3600 * 1000;

/** Statuts terminés : une exécution encore en cours n'a pas de durée à historiser. */
const FINISHED_STATUSES = new Set(['success', 'error', 'crashed', 'canceled']);

export interface SampleResult {
  instances: number;
  inserted: number;
}

/**
 * Poll léger (sans `includeData`), curseur par instance comme error-watch ;
 * premier passage = baseline d'une page pour ne pas réimporter des mois.
 * Le curseur avance sur TOUTES les exécutions vues mais seules les terminées
 * sont historisées : une `running` finie après coup est perdue — assumé, les
 * tendances se moquent de quelques exécutions manquantes.
 *
 * Seule la PROD est historisée (`isMonitoredEnv`, comme error-watch) : une durée
 * mesurée en dev ou en preprod est celle d'une mise au point — un essai à la main,
 * un jeu de données de test — et elle faisait dériver la médiane du workflow métier
 * comme une vraie régression. Le filtre est posé ICI et nulle part ailleurs : page,
 * dérive et alerte lisent `ExecutionStat` et n'ont donc rien à refiltrer.
 */
@Injectable()
export class ExecutionStatSamplerService {
  private readonly logger = new Logger(ExecutionStatSamplerService.name);
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    @Inject(N8N_API_PORT) private readonly n8nApi: N8nApiPort,
    @Inject(WORKFLOW_PLATFORM_PORTS) private readonly platforms: WorkflowPlatformPorts,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(PERFORMANCE_MANIFEST.id))) return;
    await this.sampleDueInstances();
    await this.purgeIfDue();
  }

  /** Poll de toutes les instances arrivées à échéance ; renvoie le volume inséré. */
  async sampleDueInstances(force = false): Promise<SampleResult> {
    const instances = await this.prisma.instance.findMany();
    const now = Date.now();
    let polled = 0;
    let inserted = 0;

    for (const instance of instances) {
      const cursor = await this.prisma.executionStatCursor.findUnique({
        where: { instanceId: instance.id },
      });
      if (!force && !isCheckDue(cursor?.lastPolledAt, POLL_INTERVAL_SECONDS, now)) continue;
      polled++;
      try {
        inserted +=
          instance.platform === 'n8n'
            ? await this.sampleInstance(instance, cursor?.lastSeenExecutionId ?? undefined)
            : await this.samplePlatformInstance(instance, cursor?.lastPolledAt ?? null);
      } catch (error) {
        // Instance en panne : le curseur n'a pas bougé, tout sera repris au retour.
        this.logger.warn(`Perf poll failed for ${instance.name}: ${(error as Error).message}`);
      }
    }
    return { instances: polled, inserted };
  }

  /**
   * Le poll des plateformes servies par le port commun — Make aujourd'hui.
   *
   * Il n'a pas la même forme que celui de n8n, et l'écart vient d'une contrainte
   * réelle : n8n liste les exécutions de TOUTE l'instance d'un coup, Make ne les
   * liste que scénario par scénario. Une passe coûte donc un appel par scénario,
   * sous un plafond de 30 appels par minute.
   *
   * D'où trois différences assumées :
   *
   * - on ne poll QUE les scénarios actifs et d'env surveillé — le filtre est
   *   posé AVANT l'appel, là où n8n le pose après faute de pouvoir choisir. Un
   *   scénario éteint n'exécute rien, l'interroger serait un appel perdu ;
   * - le curseur est un HORODATAGE et non un id d'exécution : `imtId` est une
   *   chaîne dont rien ne garantit l'ordre numérique, et se tromper là-dessus
   *   ferait rater des exécutions en silence. La date, elle, est sûre ;
   * - une même exécution peut être revue d'une passe à l'autre (la borne est
   *   large exprès) : `skipDuplicates` sur (instance, exécution) s'en charge.
   */
  private async samplePlatformInstance(
    instance: {
      id: string;
      name: string;
      platform: string;
      baseUrl: string;
      apiKey: string;
      zone: string | null;
      externalOrgId: string | null;
      externalTeamId: string | null;
    },
    lastPolledAt: Date | null,
  ): Promise<number> {
    const port = this.platforms[instance.platform as PlatformId];
    if (!port) return 0;
    const config = {
      baseUrl: instance.baseUrl,
      apiKey: instance.apiKey,
      zone: instance.zone ?? undefined,
      orgId: instance.externalOrgId ?? undefined,
      teamId: instance.externalTeamId ?? undefined,
    };

    const envs = await this.settings.declaredEnvs();
    const ids = envIds(envs);
    const candidates = (
      await this.prisma.workflow.findMany({
        where: { instanceId: instance.id, active: true, archivedUpstream: false, missingUpstreamAt: null },
        select: { externalId: true, name: true, tags: true },
      })
    ).filter((workflow) => isMonitoredEnv(detectWorkflowEnv(workflow.name, workflow.tags, ids), envs));

    // Première passe : on ne remonte pas l'historique entier, on se cale.
    // Ensuite : depuis la dernière passe, avec une marge d'une minute pour ne
    // rien perdre d'une exécution enregistrée pendant qu'on lisait.
    const since = lastPolledAt ? new Date(lastPolledAt.getTime() - 60_000) : null;
    let inserted = 0;

    // Première passe : on pose le curseur SANS appeler. Interroger tous les
    // scénarios pour ne rien garder brûlerait le budget d'appels de la première
    // minute, et l'historique d'avant ne nous intéresse pas.
    if (!since) {
      await this.markPolled(instance.id);
      return 0;
    }

    for (const workflow of candidates) {
      const page = await port.listExecutions(config, {
        workflowExternalId: workflow.externalId,
        limit: PAGE_SIZE,
      });
      const fresh = page.executions.filter(
        (execution) => execution.startedAt && new Date(execution.startedAt) > since,
      );
      if (fresh.length === 0) continue;

      const { count } = await this.prisma.executionStat.createMany({
        data: fresh.map((execution) => ({
          instanceId: instance.id,
          executionId: execution.externalId,
          externalWorkflowId: execution.workflowExternalId,
          status: execution.status,
          mode: null,
          startedAt: new Date(execution.startedAt!),
          stoppedAt: execution.stoppedAt ? new Date(execution.stoppedAt) : null,
          durationMs: execution.durationMs ?? executionDurationMs(execution.startedAt, execution.stoppedAt),
        })),
        skipDuplicates: true,
      });
      inserted += count;
    }

    await this.markPolled(instance.id);
    return inserted;
  }

  private async markPolled(instanceId: string): Promise<void> {
    await this.prisma.executionStatCursor.upsert({
      where: { instanceId },
      create: { instanceId, lastSeenExecutionId: null, lastPolledAt: new Date() },
      update: { lastPolledAt: new Date() },
    });
  }

  private async sampleInstance(
    instance: { id: string; baseUrl: string; apiKey: string },
    lastSeenId: string | undefined,
  ): Promise<number> {
    const fresh: N8nExecutionSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < (lastSeenId === undefined ? 1 : MAX_PAGES); page++) {
      const result = await this.n8nApi.listAllExecutions(instance, { limit: PAGE_SIZE, cursor });
      const newOnes =
        lastSeenId === undefined
          ? result.executions
          : result.executions.filter((e) => BigInt(e.id) > BigInt(lastSeenId));
      fresh.push(...newOnes);
      if (newOnes.length < result.executions.length || !result.nextCursor) break;
      cursor = result.nextCursor;
    }

    const maxSeenId = fresh.reduce((max, e) => (BigInt(e.id) > BigInt(max) ? e.id : max), lastSeenId ?? '0');

    const finished = await this.keepMonitored(
      instance.id,
      fresh.filter((e) => FINISHED_STATUSES.has(e.status) && e.startedAt),
    );
    if (finished.length > 0) {
      await this.prisma.executionStat.createMany({
        data: finished.map((e) => ({
          instanceId: instance.id,
          executionId: e.id,
          externalWorkflowId: e.workflowId,
          status: e.status,
          mode: e.mode ?? null,
          startedAt: new Date(e.startedAt!),
          stoppedAt: e.stoppedAt ? new Date(e.stoppedAt) : null,
          durationMs: executionDurationMs(e.startedAt, e.stoppedAt),
        })),
        skipDuplicates: true,
      });
    }

    await this.prisma.executionStatCursor.upsert({
      where: { instanceId: instance.id },
      create: {
        instanceId: instance.id,
        lastSeenExecutionId: maxSeenId === '0' ? null : maxSeenId,
        lastPolledAt: new Date(),
      },
      update: {
        lastSeenExecutionId: maxSeenId === '0' ? null : maxSeenId,
        lastPolledAt: new Date(),
      },
    });
    return finished.length;
  }

  /**
   * Ne garde que les exécutions des workflows de prod (ou d'env indéterminé).
   * Le curseur, lui, a déjà avalé les autres : elles sont VUES, pas historisées,
   * sans quoi chaque passe les redécouvrirait. Workflow inconnu du miroir ⇒ env
   * indéterminé, donc gardé.
   */
  private async keepMonitored(
    instanceId: string,
    executions: N8nExecutionSummary[],
  ): Promise<N8nExecutionSummary[]> {
    if (executions.length === 0) return executions;
    const n8nIds = [...new Set(executions.map((e) => e.workflowId))];
    const known = await this.prisma.workflow.findMany({
      where: { instanceId, externalId: { in: n8nIds } },
      select: { externalId: true, name: true, tags: true },
    });
    const envs = await this.settings.declaredEnvs();
    const ids = envIds(envs);
    const outOfScope = new Set(
      known
        .filter((w) => !isMonitoredEnv(detectWorkflowEnv(w.name, w.tags, ids), envs))
        .map((w) => w.externalId),
    );
    if (outOfScope.size === 0) return executions;
    return executions.filter((e) => !outOfScope.has(e.workflowId));
  }

  private async purgeIfDue(): Promise<void> {
    if (Date.now() - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = Date.now();
    const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await this.prisma.executionStat.deleteMany({
      where: { startedAt: { lt: limit } },
    });
    if (count > 0) this.logger.log(`Perf purge: ${count} execution(s) older than ${RETENTION_DAYS} d`);
    await this.purgeOutOfScope();
  }

  /**
   * Rattrapage de l'historique antérieur au filtre : les stats des workflows
   * hors env surveillé déjà en base sortiraient sinon des courbes pendant 90 jours. Se
   * charge aussi du workflow qu'on vient d'étiqueter `env:dev` après coup.
   */
  private async purgeOutOfScope(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      select: { instanceId: true, externalId: true, name: true, tags: true },
    });
    const envs = await this.settings.declaredEnvs();
    const ids = envIds(envs);
    const outOfScope = workflows.filter((w) => !isMonitoredEnv(detectWorkflowEnv(w.name, w.tags, ids), envs));
    if (outOfScope.length === 0) return;
    const { count } = await this.prisma.executionStat.deleteMany({
      where: { OR: outOfScope.map((w) => ({ instanceId: w.instanceId, externalWorkflowId: w.externalId })) },
    });
    if (count > 0) this.logger.log(`Perf purge: ${count} execution(s) outside monitored envs`);
  }
}
