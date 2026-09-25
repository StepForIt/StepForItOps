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
const CATEGORY_LABELS: Record<string, string> = {
  auth: 'authentification',
  'rate-limit': 'rate limit',
  timeout: 'timeout',
  network: 'réseau',
  data: 'données',
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
    await this.handle(event, 'onNewGroup', '🆕 Nouveau problème');
  }

  @OnEvent(EVENTS.errorGroupRegressed)
  async onGroupRegressed(event: ErrorGroupNotableEvent): Promise<void> {
    await this.handle(event, 'onRegression', `🔁 Problème revenu (${event.regressions}ᵉ rechute)`);
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
        title: `🔁 Toujours là — ${event.workflowName}`,
        body: [
          instanceName ? `Instance : ${instanceName}` : null,
          event.failedNode ? `Nœud : ${event.failedNode}` : null,
          `${digest.count} nouvelle${digest.count > 1 ? 's' : ''} exécution${digest.count > 1 ? 's' : ''} en erreur depuis ${formatTime(digest.since)}` +
            ` (${event.occurrences} au total).`,
          event.pattern,
        ]
          .filter(Boolean)
          .join('\n'),
      };
      for (const channel of channels) {
        try {
          await this.dispatch(channel, message, event);
        } catch (error) {
          this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
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
      title: `${retired ? '⛔️' : '⚠️'} Modèle ${retired ? 'retiré' : 'déprécié'} — ${event.pattern}`,
      body: [
        `Provider : ${event.provider}`,
        event.retiresAt ? `Retrait annoncé : ${event.retiresAt.slice(0, 10)}` : null,
        event.replacedByPattern ? `Successeur : ${event.replacedByPattern}` : null,
        `${event.workflows.length} nœud(s) dans ${names.length} workflow(s) : ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
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
      title: `🐢 Dérive de durée — ${event.workflowName}`,
      body: [
        instance ? `Instance : ${instance.name}` : null,
        `Médiane ×${event.ratio.toFixed(1)} vs les ${event.days} jours précédents` +
          (event.p50Ms !== null ? ` (actuelle : ${Math.round(event.p50Ms / 100) / 10} s)` : ''),
        `Une seule alerte par dérive : elle se réarmera quand la durée redescendra.`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
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
      title: `🔕 Surveillance muette — ${event.monitorName}`,
      body: [
        `${event.failures} échecs d'affilée en poussant vers la sonde Uptime Kuma.`,
        event.reason ? `Dernière erreur : ${event.reason}` : null,
        `Tant que le relais est coupé, un arrêt de ce monitor ne déclencherait AUCUNE alerte.`,
        `À vérifier : la sonde existe-t-elle encore dans Kuma ? (page Monitors → Provisionner)`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  @OnEvent(EVENTS.monitorRelayRestored)
  async onRelayRestored(event: MonitorRelayEvent): Promise<void> {
    await this.relay(event, {
      title: `🔔 Surveillance rétablie — ${event.monitorName}`,
      body: `Le push vers la sonde Uptime Kuma repasse après ${event.failures} échecs.`,
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
      title: `💸 Budget IA dépassé — ${event.costUsd.toFixed(2)} $ / ${event.budgetUsd.toFixed(2)} $`,
      body: [
        `Coût LLM du ${event.date} au-dessus du budget quotidien.`,
        top ? `Plus gros contributeurs :\n${top}` : null,
        `Une seule alerte par jour — le détail est sur la page Coûts IA.`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
    for (const channel of channels) {
      try {
        await this.dispatch(channel, message);
      } catch (error) {
        this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
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
        this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
      }
    }
  }

  /** Message d'essai vers un canal — le bouton « Tester » de la page Alertes. */
  async test(channelId: string): Promise<TestResult> {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException(`Canal ${channelId} introuvable`);
    await this.dispatch(channel, {
      title: '✅ Test de la plateforme n8n ops',
      body: `Le canal « ${channel.name} » est bien branché.`,
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
    const category = CATEGORY_LABELS[event.category];
    const message: NotificationMessage = {
      title: `${title} — ${event.workflowName}`,
      body: [
        instance ? `Instance : ${instance.name}` : null,
        event.failedNode ? `Nœud : ${event.failedNode}` : null,
        category ? `Type : ${category}` : null,
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
        this.logger.warn(`Alerte KO sur « ${channel.name} » : ${(error as Error).message}`);
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
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
