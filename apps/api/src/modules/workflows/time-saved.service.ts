import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AI_PORT, AiPort, N8nWorkflow, TimeSavedEstimate, estimateTimeSaved } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Assez pour le raisonnement ET la réponse : un budget trop juste renvoie du tronqué. */
const MAX_TOKENS = 1024;
/** Au-delà, le modèle n'apprend plus rien de la liste : les gestes se répètent. */
const MAX_NODE_LINES = 40;
/** Même plafond que le calcul déterministe : l'IA ne doit pas pouvoir le franchir. */
const MAX_MINUTES = 120;
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
  ) {}

  /**
   * Rattrapage au démarrage : les workflows déjà en base n'ont pas d'estimation
   * tant que la synchro ne les a pas revus, et le dashboard afficherait zéro
   * pendant une heure après la mise à jour.
   */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.prisma.workflow.findMany({
        where: { minutesSavedEstimate: null },
        select: { id: true },
      });
      // Les `raw` se lisent par paquets : un parc de plusieurs centaines de
      // workflows tiendrait mal en mémoire en une seule requête.
      for (let i = 0; i < pending.length; i += PAGE) {
        const rows = await this.prisma.workflow.findMany({
          where: { id: { in: pending.slice(i, i + PAGE).map((row) => row.id) } },
          select: { id: true, raw: true },
        });
        for (const row of rows) {
          await this.store(row.id, estimateTimeSaved(row.raw as unknown as N8nWorkflow), 'rules');
        }
      }
      if (pending.length > 0) this.logger.log(`Temps gagné estimé sur ${pending.length} workflow(s)`);
    } catch (error) {
      // Une base pas encore migrée ne doit pas empêcher l'api de démarrer.
      this.logger.warn(`Estimation initiale du temps gagné ignorée : ${(error as Error).message}`);
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
    const estimate = estimateTimeSaved(raw);
    return {
      minutesSavedEstimate: estimate.minutes,
      minutesSavedEstimateWhy: estimate.reason,
      minutesSavedEstimateFrom: 'rules',
    };
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
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} introuvable`);
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
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} introuvable`);

    const raw = workflow.raw as unknown as N8nWorkflow;
    const rules = estimateTimeSaved(raw);
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
          "Tu estimes le temps de travail HUMAIN qu'une exécution de ce workflow n8n remplace, " +
          'en minutes, du point de vue de celui qui aurait dû le faire à la main.\n' +
          '- Compte les gestes réels : ouvrir un outil et retrouver une donnée, saisir une ligne, ' +
          'rédiger un message, relire et décider. Ne compte pas la plomberie (Set, IF, Merge, boucles).\n' +
          '- Un appel de sous-workflow ne compte pas : il a ses propres exécutions.\n' +
          `- Une règle déterministe propose ${rules.minutes} min (${rules.reason}) : ne la contredis que si le ` +
          'détail des nœuds le justifie (volume traité, rédaction longue, geste trivial).\n' +
          `- Reste entre 0 et ${MAX_MINUTES} minutes, et sois prudent : ce chiffre alimente un ROI.\n` +
          'Réponds en JSON : {"minutes":number,"reason":"une phrase en français, ce que ça remplace"}',
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
      this.logger.warn(`Temps gagné laissé à la règle : ${(error as Error).message}`);
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
