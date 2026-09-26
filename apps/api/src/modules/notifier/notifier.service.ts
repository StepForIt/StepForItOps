import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AiCostBudgetExceededEvent,
  AlertDigestBuffer,
  EVENTS,
  ErrorGroupNotableEvent,
  MonitorRelayEvent,
  NOTIFICATION_PORT,
  NotificationMessage,
  NotificationPort,
  ModelLifecycleChangedEvent,
  PerfDriftDetectedEvent,
  currentLocale,
  msg,
  MessageId,
} from '@nwm/core';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { NOTIFIER_MANIFEST } from './manifest';

/**
 * Au-delà, l'événement raconte le passé (backfill, regroupement de rattrapage) :
 * on historise sans alerter — personne ne veut 300 Slack sur des erreurs du mois dernier.
 */
const FRESHNESS_HOURS = 6;

/**
 * Fenêtre de regroupement des occurrences d'un problème déjà annoncé : un workflow
 * qui casse à chaque exécution donne UN récapitulatif toutes les dix minutes, pas
 * un message par exécution — au-delà de la première alerte, seul le rythme informe.
 */
const DIGEST_WINDOW_MS = 10 * 60 * 1000;

/** Ce qu'on retient d'un problème annoncé, le temps de compter ses répétitions. */
interface DigestPayload {
  event: ErrorGroupNotableEvent;
  /** Canaux à qui la première alerte est partie : le rappel suit le même chemin. */
  toggle: NotifiableToggle;
  instanceName: string | null;
}

type NotifiableToggle = 'onNewGroup' | 'onRegression';

/** Libellés des catégories dans les messages (même vocabulaire que la page Erreurs). */
const CATEGORY_LABELS: Record<string, MessageId> = {
  auth: 'ops.alertCategoryAuth',
  'rate-limit': 'ops.alertCategoryRateLimit',
  timeout: 'ops.alertCategoryTimeout',
  network: 'ops.alertCategoryNetwork',
  data: 'ops.alertCategoryData',
};

export interface TestResult {
  ok: boolean;
}

/**
 * Transforme les événements « un humain doit le savoir » en notifications.
 * Le module écoute — il n'importe le service d'aucun autre module : tout
 * arrive par le bus (`errorGroup.opened`, `errorGroup.regressed`, `errorGroup.recurred`).
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  /**
   * En mémoire : un redémarrage perd les compteurs en cours, ce qui coûte au pire
   * un récapitulatif — la première alerte, elle, est déjà partie.
   */
  private readonly digests = new AlertDigestBuffer<DigestPayload>(DIGEST_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
  ) {}

  @OnEvent(EVENTS.errorGroupOpened)
  async onGroupOpened(event: ErrorGroupNotableEvent): Promise<void> {
    await this.handle(event, 'onNewGroup', msg('ops.alertNewGroup'));
  }

  @OnEvent(EVENTS.errorGroupRegressed)
  async onGroupRegressed(event: ErrorGroupNotableEvent): Promise<void> {
    await this.handle(event, 'onRegression', msg('ops.alertRegressed', { regressions: event.regressions }));
  }

  /**
   * Occurrence de plus sur un problème déjà annoncé : on compte, on n'envoie rien.
   * Le récapitulatif part à la fermeture de la fenêtre (`flushDigests`).
   */
  @OnEvent(EVENTS.errorGroupRecurred)
  async onGroupRecurred(event: ErrorGroupNotableEvent): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    if (!this.isFresh(event)) return;
    this.digests.add(event.groupId, (previous) => ({ ...previous, event }));
  }

  /**
   * « Depuis 9 h 40, 5 nouvelles exécutions avec le même problème. » Un seul message
   * par fenêtre et par problème, et plus rien dès qu'il se tait.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async flushDigests(): Promise<void> {
    if (this.digests.size === 0) return;
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;

    for (const digest of this.digests.due(new Date())) {
      const { event, toggle, instanceName } = digest.payload;
      const channels = await this.prisma.notificationChannel.findMany({
        where: { enabled: true, [toggle]: true },
      });
      if (channels.length === 0) continue;

      const message: NotificationMessage = {
        title: msg('ops.alertStillThere', { workflow: event.workflowName }),
        body: [
          instanceName ? msg('ops.alertInstance', { name: instanceName }) : null,
          event.failedNode ? msg('ops.alertNode', { name: event.failedNode }) : null,
          msg('ops.alertDigest', {
            count: digest.count,
            since: formatTime(digest.since),
            total: event.occurrences,
          }),
          event.pattern,
        ]
          .filter(Boolean)
          .join('\n'),
      };
      for (const channel of channels) {
        try {
          await this.dispatch(channel, message, event);
        } catch (error) {
          this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
        }
      }
    }
  }

  /**
   * Un modèle du parc vient d'être déprécié ou retiré. Une alerte par MODÈLE :
   * les quarante workflows touchés sont dans le corps, pas dans quarante messages.
   */
  @OnEvent(EVENTS.modelLifecycleChanged)
  async onModelLifecycle(event: ModelLifecycleChangedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    const channels = await this.prisma.notificationChannel.findMany({
      where: { enabled: true, onModelLifecycle: true },
    });
    if (channels.length === 0) return;

    const retired = event.to === 'retired';
    const names = [...new Set(event.workflows.map((workflow) => workflow.name))];
    const message: NotificationMessage = {
      title: msg('ops.alertModelTitle', { retired, pattern: event.pattern }),
      body: [
        msg('ops.alertModelProvider', { provider: event.provider }),
        event.retiresAt ? msg('ops.alertModelRetiresAt', { date: event.retiresAt.slice(0, 10) }) : null,
        event.replacedByPattern ? msg('ops.alertModelSuccessor', { pattern: event.replacedByPattern }) : null,
        msg('ops.alertModelNodes', {
          nodes: event.workflows.length,
          workflows: names.length,
          names: `${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`,
        }),
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
      }
    }
  }

  @OnEvent(EVENTS.perfDriftDetected)
  async onPerfDrift(event: PerfDriftDetectedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    const channels = await this.prisma.notificationChannel.findMany({
      where: { enabled: true, onPerfDrift: true },
    });
    if (channels.length === 0) return;

    const instance = await this.prisma.instance.findUnique({
      where: { id: event.instanceId },
      select: { name: true },
    });
    const message: NotificationMessage = {
      title: msg('ops.alertDriftTitle', { workflow: event.workflowName }),
      body: [
        instance ? msg('ops.alertInstance', { name: instance.name }) : null,
        msg('ops.alertDriftMedian', {
          ratio: event.ratio.toFixed(1),
          days: event.days,
          hasCurrent: event.p50Ms !== null,
          current: event.p50Ms !== null ? String(Math.round(event.p50Ms / 100) / 10) : '',
        }),
        msg('ops.alertDriftOnce'),
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
      }
    }
  }

  /**
   * Le relais de surveillance lui-même : sans lui, la sonde ne tombe plus et l'arrêt du poll
   * qu'elle couvre passerait inaperçu — l'angle mort qui laisse croire que tout va bien.
   */
  @OnEvent(EVENTS.monitorRelayBroken)
  async onRelayBroken(event: MonitorRelayEvent): Promise<void> {
    await this.relay(event, {
      title: msg('ops.alertRelayBrokenTitle', { monitor: event.monitorName }),
      body: [
        msg('ops.alertRelayBrokenFailures', { failures: event.failures }),
        event.reason ? msg('ops.alertRelayLastError', { reason: event.reason }) : null,
        msg('ops.alertRelayBrokenImpact'),
        msg('ops.alertRelayBrokenCheck'),
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  @OnEvent(EVENTS.monitorRelayRestored)
  async onRelayRestored(event: MonitorRelayEvent): Promise<void> {
    await this.relay(event, {
      title: msg('ops.alertRelayRestoredTitle', { monitor: event.monitorName }),
      body: msg('ops.alertRelayRestoredBody', { failures: event.failures }),
    });
  }

  @OnEvent(EVENTS.aiCostBudgetExceeded)
  async onBudgetExceeded(event: AiCostBudgetExceededEvent): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    const channels = await this.prisma.notificationChannel.findMany({
      where: { enabled: true, onBudget: true },
    });
    if (channels.length === 0) return;

    const top = event.topWorkflows
      .map((w) => `• ${w.name} : ${w.costUsd.toFixed(w.costUsd >= 1 ? 2 : 4)} $`)
      .join('\n');
    const message: NotificationMessage = {
      title: msg('ops.alertBudgetTitle', {
        cost: event.costUsd.toFixed(2),
        budget: event.budgetUsd.toFixed(2),
      }),
      body: [
        msg('ops.alertBudgetBody', { date: event.date }),
        top ? msg('ops.alertBudgetTop', { top }) : null,
        msg('ops.alertBudgetOnce'),
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
      }
    }
  }

  /** Diffusion d'un message de relais sur les canaux qui suivent la santé de la surveillance. */
  private async relay(event: MonitorRelayEvent, message: NotificationMessage): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    const channels = await this.prisma.notificationChannel.findMany({
      where: { enabled: true, onRelayBroken: true },
    });
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
      }
    }
  }

  /** Message d'essai vers un canal — le bouton « Tester » de la page Alertes. */
  async test(channelId: string): Promise<TestResult> {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException(msg('ops.channelNotFound', { id: channelId }));
    await this.dispatch(channel, {
      title: msg('ops.channelTestTitle'),
      body: msg('ops.channelTestBody', { name: channel.name }),
    });
    return { ok: true };
  }

  private async handle(
    event: ErrorGroupNotableEvent,
    toggle: NotifiableToggle,
    title: string,
  ): Promise<void> {
    if (!(await this.registry.isEnabled(NOTIFIER_MANIFEST.id))) return;
    if (!this.isFresh(event)) return;

    const channels = await this.prisma.notificationChannel.findMany({
      where: { enabled: true, [toggle]: true },
    });
    if (channels.length === 0) return;

    const instance = await this.prisma.instance.findUnique({
      where: { id: event.instanceId },
      select: { name: true },
    });
    const categoryId = CATEGORY_LABELS[event.category];
    const category = categoryId ? msg(categoryId) : null;
    const message: NotificationMessage = {
      title: `${title} — ${event.workflowName}`,
      body: [
        instance ? msg('ops.alertInstance', { name: instance.name }) : null,
        event.failedNode ? msg('ops.alertNode', { name: event.failedNode }) : null,
        category ? msg('ops.alertType', { category }) : null,
        event.pattern,
      ]
        .filter(Boolean)
        .join('\n'),
    };

    for (const channel of channels) {
      try {
        await this.dispatch(channel, message, event);
      } catch (error) {
        // Un canal en panne ne doit ni bloquer les autres, ni casser l'ingestion des erreurs.
        this.logger.warn(`Alert failed on "${channel.name}": ${(error as Error).message}`);
      }
    }

    // Le problème est annoncé : ses occurrences suivantes seront comptées, pas répétées.
    this.digests.arm(event.groupId, { event, toggle, instanceName: instance?.name ?? null }, new Date());
  }

  /** Trop vieux = backfill : cf. FRESHNESS_HOURS. */
  private isFresh(event: ErrorGroupNotableEvent): boolean {
    return Date.now() - new Date(event.occurredAt).getTime() <= FRESHNESS_HOURS * 3600 * 1000;
  }

  private async dispatch(
    channel: NotificationChannel,
    message: NotificationMessage,
    event?: ErrorGroupNotableEvent,
  ): Promise<void> {
    if (channel.type === 'slack') {
      await this.notifications.sendSlack(channel.url, message);
      return;
    }
    // Webhook générique : le message lisible + l'événement brut, au receveur de choisir.
    await this.notifications.sendWebhook(channel.url, {
      title: message.title,
      body: message.body,
      ...(event ? { event } : {}),
    });
  }
}

/** Heure locale « 9 h 40 » : le récapitulatif dit depuis quand on compte. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
}
