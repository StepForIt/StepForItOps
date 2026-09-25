import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EVENTS,
  MONITOR_PORT,
  MonitorErroredExecution,
  MonitorErrorsDetectedEvent,
  MonitorPort,
  MonitorRelayEvent,
  N8N_API_PORT,
  N8nApiPort,
  N8nExecutionSummary,
  PlatformId,
  WorkflowPlatformPorts,
  WORKFLOW_PLATFORM_PORTS,
  EnvName,
  detectWorkflowEnv,
  envIds,
  isCheckDue,
  isMonitoredEnv,
} from '@nwm/core';
import { Monitor } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { MONITORING_MANIFEST } from './manifest';
import { DEFAULT_ERROR_WATCH_INTERVAL_SECONDS } from './probe-interval';

interface ErrorWatchConfig {
  instanceId?: string;
  intervalSeconds?: number;
  limit?: number;
}

interface ErrorWatchState {
  lastSeenExecutionId?: string;
  /**
   * Curseur des plateformes qui n'ont pas d'id d'exécution ordonnable (Make) :
   * un horodatage ISO. Se tromper sur l'ordre d'un id ferait rater des erreurs
   * en silence, ce qui est le pire mode de panne pour un chien de garde.
   */
  lastSeenAt?: string;
  /** Échecs de push consécutifs vers la sonde (0 dès qu'un push repasse). */
  pushFailures?: number;
}

const MAX_PAGES = 5;
/** Échecs de push consécutifs avant d'alerter — un hoquet réseau ne doit pas réveiller. */
const PUSH_FAILURE_THRESHOLD = 3;
const MAX_MESSAGE_LENGTH = 200;

/**
 * Surveillance des exécutions en erreur d'une instance n8n, sans générer d'exécution :
 * poll de l'API publique avec un curseur (chaque erreur n'est signalée qu'une fois),
 * résultat poussé vers la sonde push Uptime Kuma du monitor.
 *
 * Seuls les envs DÉCLARÉS surveillés le sont (`isMonitoredEnv`, coché par env dans
 * les réglages ; la prod par défaut) : ailleurs, une erreur est le bruit normal du
 * travail en cours, et la remonter revenait à alerter sur une
 * mise au point. Rien n'est historisé ni alerté pour elles — l'ingestion, les groupes
 * et le `notifier` sont tous en aval de cet événement.
 */
@Injectable()
export class ErrorWatchService {
  private readonly logger = new Logger(ErrorWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly registry: ModuleRegistryService,
    @Inject(MONITOR_PORT) private readonly monitorPort: MonitorPort,
    @Inject(N8N_API_PORT) private readonly n8nApi: N8nApiPort,
    @Inject(WORKFLOW_PLATFORM_PORTS) private readonly platforms: WorkflowPlatformPorts,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(MONITORING_MANIFEST.id))) return;
    const monitors = await this.prisma.monitor.findMany({ where: { kind: 'error-watch', enabled: true } });
    const now = Date.now();

    for (const monitor of monitors) {
      const config = (monitor.config ?? {}) as ErrorWatchConfig;
      const interval = config.intervalSeconds ?? DEFAULT_ERROR_WATCH_INTERVAL_SECONDS;
      if (!isCheckDue(monitor.lastCheckAt, interval, now)) continue;
      await this.check(monitor);
    }
  }

  async check(monitor: Monitor): Promise<'up' | 'down'> {
    const config = (monitor.config ?? {}) as ErrorWatchConfig;
    const state = (monitor.state ?? {}) as ErrorWatchState;

    if (!config.instanceId) {
      return this.disableMisconfigured(monitor, 'config.instanceId manquant');
    }
    const instance = await this.prisma.instance.findUnique({ where: { id: config.instanceId } });
    if (!instance) {
      return this.disableMisconfigured(monitor, `instance ${config.instanceId} introuvable`);
    }

    const isN8n = instance.platform === 'n8n';
    let fresh: N8nExecutionSummary[];
    let newState: ErrorWatchState;
    let baseline: boolean;

    try {
      if (isN8n) {
        fresh = await this.collectNewErrors(instance, config, state.lastSeenExecutionId);
        newState = {
          lastSeenExecutionId: fresh.reduce(
            (max, e) => (BigInt(e.id) > BigInt(max) ? e.id : max),
            state.lastSeenExecutionId ?? '0',
          ),
        };
        baseline = state.lastSeenExecutionId === undefined;
      } else {
        // Le curseur est une DATE : les ids d'exécution de Make ne s'ordonnent pas.
        fresh = await this.collectPlatformErrors(instance, state.lastSeenAt);
        newState = { lastSeenAt: new Date().toISOString() };
        baseline = state.lastSeenAt === undefined;
      }
    } catch (error) {
      // state inchangé : les erreurs survenues pendant la panne seront signalées au retour
      return this.conclude(monitor, 'down', `API injoignable : ${(error as Error).message}`, state);
    }

    // Premier passage : baseline silencieuse, on ne re-signale pas l'historique d'erreurs
    if (baseline) {
      return this.conclude(monitor, 'up', 'OK (baseline)', newState);
    }
    if (fresh.length === 0) {
      return this.conclude(monitor, 'up', 'OK', newState);
    }

    // Le curseur, lui, a déjà avalé les erreurs hors prod : elles sont VUES, pas
    // signalées — sans quoi chaque passe les redécouvrirait.
    const envs = await this.settings.declaredEnvs();
    const byWorkflow = (await this.groupByWorkflow(instance.id, fresh, envIds(envs))).filter((w) =>
      isMonitoredEnv(w.env, envs),
    );
    const count = byWorkflow.reduce((total, w) => total + w.executions.length, 0);
    const ignored = fresh.length - count;
    if (count === 0) {
      return this.conclude(monitor, 'up', `OK (${ignored} erreur(s) hors env surveillé)`, newState);
    }

    const summary = byWorkflow
      .map((w) => (w.executions.length > 1 ? `${w.name} (×${w.executions.length})` : w.name))
      .join(', ');
    const suffix = ignored > 0 ? ` (+${ignored} hors prod)` : '';
    const message = truncate(`${count} nouvelle(s) erreur(s) : ${summary}${suffix}`, MAX_MESSAGE_LENGTH);

    const event: MonitorErrorsDetectedEvent = {
      monitorId: monitor.id,
      instanceId: instance.id,
      count,
      workflows: byWorkflow.map(({ externalId, name, executions }) => ({ externalId, name, executions })),
    };
    this.eventBus.emit(EVENTS.monitorErrorsDetected, event);

    return this.conclude(monitor, 'down', message, newState);
  }

  /**
   * Les erreurs d'une plateforme servie par le port commun — Make aujourd'hui.
   *
   * Make n'a pas de listing global des exécutions : on interroge les logs
   * scénario par scénario. Comme chaque appel coûte, le filtre « env surveillé »
   * est posé AVANT l'appel, et les scénarios éteints ne sont pas interrogés du
   * tout — ils n'exécutent rien.
   *
   * Le poll est volontairement indépendant de celui du module `performance`, qui
   * lit pourtant les mêmes logs : un chien de garde qui s'arrêterait parce qu'un
   * AUTRE module a été désactivé serait pire qu'inutile, il serait trompeur.
   */
  private async collectPlatformErrors(
    instance: {
      id: string;
      platform: string;
      baseUrl: string;
      apiKey: string;
      zone: string | null;
      externalOrgId: string | null;
      externalTeamId: string | null;
    },
    lastSeenAt: string | undefined,
  ): Promise<N8nExecutionSummary[]> {
    const port = this.platforms[instance.platform as PlatformId];
    if (!port) return [];
    if (lastSeenAt === undefined) return []; // baseline : on se cale sans interroger

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

    // Marge d'une minute : une exécution enregistrée pendant qu'on lisait la
    // page précédente ne doit pas passer entre deux passes.
    const since = new Date(new Date(lastSeenAt).getTime() - 60_000);
    const fresh: N8nExecutionSummary[] = [];

    for (const workflow of candidates) {
      const page = await port.listExecutions(config, { workflowExternalId: workflow.externalId, limit: 100 });
      for (const execution of page.executions) {
        if (execution.status !== 'error') continue;
        if (!execution.startedAt || new Date(execution.startedAt) <= since) continue;
        fresh.push({
          id: execution.externalId,
          workflowId: execution.workflowExternalId,
          status: 'error',
          startedAt: execution.startedAt,
          stoppedAt: execution.stoppedAt,
        });
      }
    }
    return fresh;
  }

  /** Pagine les exécutions en erreur jusqu'au dernier ID déjà vu (ou une page en baseline). */
  private async collectNewErrors(
    instance: { baseUrl: string; apiKey: string },
    config: ErrorWatchConfig,
    lastSeenId: string | undefined,
  ): Promise<N8nExecutionSummary[]> {
    const fresh: N8nExecutionSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < (lastSeenId === undefined ? 1 : MAX_PAGES); page++) {
      const result = await this.n8nApi.listErrorExecutions(instance, { limit: config.limit ?? 50, cursor });
      const newOnes =
        lastSeenId === undefined
          ? result.executions
          : result.executions.filter((e) => BigInt(e.id) > BigInt(lastSeenId));
      fresh.push(...newOnes);
      // Page incomplète en nouveautés (on a atteint le déjà-vu) ou plus de pages : terminé
      if (newOnes.length < result.executions.length || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return fresh;
  }

  /**
   * Regroupe par workflow et résout nom et environnement depuis la DB plateforme
   * (l'API publique ne renvoie ni l'un ni l'autre). Workflow inconnu du miroir ⇒
   * env indéterminé, donc surveillé.
   */
  private async groupByWorkflow(
    instanceId: string,
    executions: N8nExecutionSummary[],
    envs: readonly string[],
  ): Promise<
    Array<{ externalId: string; name: string; env: EnvName | null; executions: MonitorErroredExecution[] }>
  > {
    const byN8nId = new Map<string, MonitorErroredExecution[]>();
    for (const execution of executions) {
      const list = byN8nId.get(execution.workflowId) ?? [];
      list.push({
        id: execution.id,
        startedAt: execution.startedAt,
        stoppedAt: execution.stoppedAt,
        mode: execution.mode,
      });
      byN8nId.set(execution.workflowId, list);
    }
    const known = await this.prisma.workflow.findMany({
      where: { instanceId, externalId: { in: [...byN8nId.keys()] } },
      select: { externalId: true, name: true, tags: true },
    });
    const mirrored = new Map(known.map((w) => [w.externalId, w]));
    return [...byN8nId.entries()].map(([externalId, list]) => {
      const workflow = mirrored.get(externalId);
      return {
        externalId,
        name: workflow?.name ?? externalId,
        env: workflow ? detectWorkflowEnv(workflow.name, workflow.tags, envs) : null,
        executions: list,
      };
    });
  }

  /**
   * Instance absente = erreur de configuration (config importée d'une autre plateforme,
   * cf. `instanceRef` dans config-transfer), pas une panne : le monitor se désactive au
   * lieu de pousser un `down` — `kumaPushUrl` recopié à l'import vise souvent la sonde
   * de la plateforme d'origine, qui verrait son historique pollué.
   */
  private async disableMisconfigured(monitor: Monitor, reason: string): Promise<'down'> {
    await this.prisma.monitor.update({
      where: { id: monitor.id },
      data: { enabled: false, lastStatus: 'down', lastCheckAt: new Date() },
    });
    this.logger.warn(
      `error-watch ${monitor.name} désactivé : ${reason} — choisissez son instance puis réactivez-le`,
    );
    return 'down';
  }

  private async conclude(
    monitor: Monitor,
    status: 'up' | 'down',
    message: string,
    state: ErrorWatchState,
  ): Promise<'up' | 'down'> {
    const pushFailures = monitor.kumaPushUrl
      ? await this.pushAndCount(monitor, monitor.kumaPushUrl, status, message)
      : 0;
    await this.prisma.monitor.update({
      where: { id: monitor.id },
      data: { lastStatus: status, lastCheckAt: new Date(), state: { ...state, pushFailures } },
    });
    if (status === 'down') this.logger.warn(`error-watch ${monitor.name} : ${message}`);
    return status;
  }

  /**
   * La sonde est ce qui tombe DOWN quand ce poll s'arrête : un relais muet rend donc la panne
   * suivante invisible, d'où l'alerte au franchissement du seuil — une seule, le compteur ne
   * repassant par là qu'après un succès.
   */
  private async pushAndCount(
    monitor: Monitor,
    pushUrl: string,
    status: 'up' | 'down',
    message: string,
  ): Promise<number> {
    const previous = ((monitor.state ?? {}) as ErrorWatchState).pushFailures ?? 0;
    try {
      await this.monitorPort.push(pushUrl, status, message);
      if (previous >= PUSH_FAILURE_THRESHOLD) {
        this.emitRelay(EVENTS.monitorRelayRestored, monitor, previous);
      }
      return 0;
    } catch (error) {
      const reason = (error as Error).message;
      const failures = previous + 1;
      this.logger.warn(`Push Kuma KO pour ${monitor.name} : ${reason}`);
      if (failures === PUSH_FAILURE_THRESHOLD) {
        this.emitRelay(EVENTS.monitorRelayBroken, monitor, failures, reason);
      }
      return failures;
    }
  }

  private emitRelay(
    name: typeof EVENTS.monitorRelayBroken | typeof EVENTS.monitorRelayRestored,
    monitor: Monitor,
    failures: number,
    reason?: string,
  ): void {
    const event: MonitorRelayEvent = {
      monitorId: monitor.id,
      monitorName: monitor.name,
      failures,
      ...(reason ? { reason } : {}),
      occurredAt: new Date().toISOString(),
    };
    this.eventBus.emit(name, event);
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
