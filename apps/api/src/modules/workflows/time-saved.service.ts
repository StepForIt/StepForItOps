import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  N8nWorkflow,
  TimeSavedEstimate,
  MAX_TIME_SAVED_MINUTES,
  estimateTimeSaved,
  msg,
  writeInLanguage,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';

/** Assez pour le raisonnement ET la réponse : un budget trop juste renvoie du tronqué. */
const MAX_TOKENS = 1024;
/** Au-delà, le modèle n'apprend plus rien de la liste : les gestes se répètent. */
const MAX_NODE_LINES = 40;
/** Même plafond que le calcul déterministe : l'IA ne doit pas pouvoir le franchir. */
const MAX_MINUTES = MAX_TIME_SAVED_MINUTES;
/** Taille des paquets du rattrapage au démarrage (les `raw` sont gros). */
const PAGE = 50;

export interface TimeSavedView {
  /** Le chiffre qui compte pour le ROI : la saisie humaine si elle existe, sinon l'estimation. */
  minutes: number | null;
  /** Vrai quand personne n'a tranché à la main. */
  estimated: boolean;
  estimate: { minutes: number; why: string | null; source: string | null } | null;
}

/**
 * L'estimation du temps gagné, posée par défaut sur tout le parc.
 *
 * Deux étages, comme la proposition de version : le calcul déterministe
 * (`estimateTimeSaved`) est la valeur par défaut ET le repli — il tourne à
 * chaque changement de contenu, sans réseau ni clé —, l'IA ne fait que
 * l'affiner sur demande, workflow par workflow. Estimer un parc entier à l'IA
 * coûterait des centaines d'appels pour un chiffre qui reste une estimation.
 *
 * Rien de tout ça n'écrase `minutesSavedPerExecution` : un chiffre posé par un
 * humain est le seul des deux qui ait été mesuré.
 */
@Injectable()
export class TimeSavedService implements OnModuleInit {
  private readonly logger = new Logger(TimeSavedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    private readonly platformLocale: PlatformLocale,
  ) {}

  /**
   * Rattrapage au démarrage : les workflows déjà en base n'ont pas d'estimation
   * tant que la synchro ne les a pas revus, et le dashboard afficherait zéro
   * pendant une heure après la mise à jour.
   *
   * Les estimations posées par la RÈGLE sont aussi recalculées : elles dérivent
   * du contenu et de la formule, et une formule corrigée ne doit pas laisser les
   * workflows inchangés sur l'ancien chiffre (la synchro ne les revoit que si leur
   * contenu bouge). Idempotent — la règle est déterministe — et sans écriture
   * quand rien ne change. Celles affinées par l'IA, elles, sont un jugement :
   * on ne les écrase pas.
   */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.prisma.workflow.findMany({
        where: { OR: [{ minutesSavedEstimate: null }, { minutesSavedEstimateFrom: 'rules' }] },
        select: { id: true },
      });
      let updated = 0;
      // Les `raw` se lisent par paquets : un parc de plusieurs centaines de
      // workflows tiendrait mal en mémoire en une seule requête.
      for (let i = 0; i < pending.length; i += PAGE) {
        const rows = await this.prisma.workflow.findMany({
          where: { id: { in: pending.slice(i, i + PAGE).map((row) => row.id) } },
          select: { id: true, raw: true, minutesSavedEstimate: true, minutesSavedEstimateWhy: true },
        });
        for (const row of rows) {
          const estimate = this.estimate(row.raw as unknown as N8nWorkflow);
          if (
            row.minutesSavedEstimate === estimate.minutes &&
            row.minutesSavedEstimateWhy === estimate.reason
          ) {
            continue;
          }
          await this.store(row.id, estimate, 'rules');
          updated += 1;
        }
      }
      if (updated > 0) this.logger.log(`Time saved re-estimated on ${updated} workflow(s)`);
    } catch (error) {
      // Une base pas encore migrée ne doit pas empêcher l'api de démarrer.
      this.logger.warn(`Initial time-saved estimate skipped: ${(error as Error).message}`);
    }
  }

  /**
   * Les colonnes d'estimation pour un contenu donné, à fondre dans l'écriture du
   * miroir : la synchro écrit déjà la ligne, un UPDATE de plus par workflow et
   * par passe ne se justifie pas.
   */
  estimateFields(raw: N8nWorkflow): {
    minutesSavedEstimate: number;
    minutesSavedEstimateWhy: string;
    minutesSavedEstimateFrom: string;
  } {
    const estimate = this.estimate(raw);
    return {
      minutesSavedEstimate: estimate.minutes,
      minutesSavedEstimateWhy: estimate.reason,
      minutesSavedEstimateFrom: 'rules',
    };
  }

  /** La raison est stockée : elle s'écrit dans la langue de la plateforme, pas dans celle de l'appelant. */
  private estimate(raw: N8nWorkflow): TimeSavedEstimate {
    return this.platformLocale.run(() => estimateTimeSaved(raw));
  }

  async view(workflowId: string): Promise<TimeSavedView> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        minutesSavedPerExecution: true,
        minutesSavedEstimate: true,
        minutesSavedEstimateWhy: true,
        minutesSavedEstimateFrom: true,
      },
    });
    if (!workflow) throw new NotFoundException(msg('platform.workflowNotFound', { id: workflowId }));
    return {
      minutes: workflow.minutesSavedPerExecution ?? workflow.minutesSavedEstimate ?? null,
      estimated: workflow.minutesSavedPerExecution == null,
      estimate:
        workflow.minutesSavedEstimate == null
          ? null
          : {
              minutes: workflow.minutesSavedEstimate,
              why: workflow.minutesSavedEstimateWhy,
              source: workflow.minutesSavedEstimateFrom,
            },
    };
  }

  /**
   * Affinage par l'IA d'UN workflow : elle voit ce que la règle ne lit pas — que
   * ce nœud-là écrit une facture quand celui-ci coche une case. Sans clé, sur
   * une réponse hors bornes ou en erreur, on garde le calcul déterministe.
   */
  async refine(workflowId: string): Promise<TimeSavedView> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, name: true, raw: true },
    });
    if (!workflow) throw new NotFoundException(msg('platform.workflowNotFound', { id: workflowId }));

    const raw = workflow.raw as unknown as N8nWorkflow;
    const rules = this.estimate(raw);
    if (await this.ai.isConfigured()) {
      const refined = await this.askAi(workflow.name, raw, rules);
      if (refined) {
        await this.store(workflow.id, refined, 'ai');
        return this.view(workflow.id);
      }
    }
    await this.store(workflow.id, rules, 'rules');
    return this.view(workflow.id);
  }

  private async askAi(
    name: string,
    raw: N8nWorkflow,
    rules: TimeSavedEstimate,
  ): Promise<TimeSavedEstimate | null> {
    try {
      const answer = await this.ai.generateJson<{ minutes?: number; reason?: string }>({
        system:
          'You estimate the HUMAN time that ONE execution of this n8n workflow replaces, in minutes.\n' +
          '- Start from WHAT THE WORKFLOW DOES for the business (e.g. "sorts one incoming email", ' +
          '"creates one invoice"), then ask how long a person would take to do that one task by hand.\n' +
          '- The number of nodes and their complexity are NOT a measure of time: a 40-node workflow that ' +
          'sorts an email replaces about as much work as a 5-node one. Never add up nodes.\n' +
          '- One execution = one unit of work (one email, one lead, one order), unless the workflow ' +
          'clearly loops over a batch.\n' +
          '- Reference scale: sorting or labelling an email 1-3 min, answering one 5-10 min, entering ' +
          'a record 2-5 min, preparing a report or a quote 15-30 min. Be conservative: this figure feeds ' +
          'an ROI and an overestimate is worse than an underestimate.\n' +
          '- Ignore the plumbing (Set, IF, Merge, loops, sub-workflow calls).\n' +
          `- A rough rule-based figure is ${rules.minutes} min: it ignores the purpose of the workflow, ` +
          'so do not anchor on it, and go lower whenever the task is simple.\n' +
          `- Stay between 0 and ${MAX_MINUTES} minutes.\n` +
          'Reply in JSON: {"minutes":number,"reason":"one sentence: the task replaced and how long it takes by hand"}\n' +
          this.platformLocale.run(() => writeInLanguage()),
        prompt: JSON.stringify(summarize(name, raw)),
        maxTokens: MAX_TOKENS,
        effort: 'low',
      });
      const minutes = answer?.minutes;
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
        return null;
      }
      return {
        minutes: Math.round(minutes * 2) / 2,
        reason: answer.reason?.trim() || rules.reason,
        breakdown: rules.breakdown,
        capped: false,
      };
    } catch (error) {
      this.logger.warn(`Time saved left to the rule: ${(error as Error).message}`);
      return null;
    }
  }

  private async store(
    workflowId: string,
    estimate: TimeSavedEstimate,
    source: 'rules' | 'ai',
  ): Promise<void> {
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        minutesSavedEstimate: estimate.minutes,
        minutesSavedEstimateWhy: estimate.reason,
        minutesSavedEstimateFrom: source,
      },
    });
  }
}

/**
 * Ce que le modèle a besoin de voir : le geste, pas le JSON. Envoyer les
 * paramètres entiers ferait payer des milliers de lignes — et y glisserait des
 * secrets — pour un nombre en retour.
 */
function summarize(name: string, raw: N8nWorkflow) {
  const nodes = (raw.nodes ?? []).filter((node) => !node.disabled);
  return {
    workflow: name,
    nodeCount: nodes.length,
    nodes: nodes.slice(0, MAX_NODE_LINES).map((node) => ({
      name: node.name,
      type: node.type,
      operation: (node.parameters as Record<string, unknown> | undefined)?.['operation'],
      resource: (node.parameters as Record<string, unknown> | undefined)?.['resource'],
    })),
  };
}
