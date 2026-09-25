import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PORT, AiPort, AssistantDraftRepairedEvent, CorrectionChange, MAX_LESSON_LENGTH } from '@nwm/core';
import { LessonStoreService } from './lesson-store.service';

interface DistilledLesson {
  /** La règle, dégagée de son cas. `null` quand le changement n'en portait pas. */
  rule: string | null;
  /** Pourquoi, quand il n'y a pas de règle : sert à comprendre les silences. */
  why?: string;
}

/**
 * Transforme un changement observé en une règle réutilisable — ou en rien.
 *
 * Le travail n'est pas de décrire ce qui a changé (le diff le dit déjà) mais de
 * DÉGAGER le cas particulier : « sur ce nœud Notion, `values` devait être
 * `propertyValues` » ne vaut que pour ce nœud, alors que « les sous-clés d'une
 * fixedCollection sont celles que déclare le nœud, jamais `values` par défaut »
 * vaut pour tout le parc. Une leçon qui garde un nom de workflow, un id ou une
 * url n'est pas une leçon : c'est un souvenir, et `chat-memory` est fait pour ça.
 *
 * Hors du tour, en `low` : personne n'attend que l'assistant apprenne, et une
 * distillation qui coûterait cher ne serait jamais rentable — on en fait une par
 * correction, pas une par question.
 */
@Injectable()
export class LessonDistillService {
  private readonly logger = new Logger(LessonDistillService.name);

  constructor(
    @Inject(AI_PORT) private readonly ai: AiPort,
    private readonly store: LessonStoreService,
  ) {}

  /** Distille les changements qu'on sait déjà être des erreurs (verdict `lesson`). */
  async fromCorrection(workflowId: string, changes: CorrectionChange[]): Promise<void> {
    if (!(await this.ai.isConfigured())) return;
    for (const change of changes) {
      const rule = await this.distill(change);
      if (!rule) continue;
      await this.store.record({
        content: rule,
        nodeTypes: change.nodeType ? [change.nodeType] : [],
        origin: 'human-correction',
        originWorkflowId: workflowId,
      });
    }
  }

  /**
   * Distille la RÉPONSE d'un humain à une question restée en suspens.
   *
   * Active tout de suite : quelqu'un vient de confirmer, il n'y a plus rien à
   * attendre d'une seconde occurrence.
   */
  async fromAnswer(input: {
    workflowId: string;
    change: CorrectionChange;
    answer: string;
    author?: string | null;
  }): Promise<string | null> {
    if (!(await this.ai.isConfigured())) return null;
    const rule = await this.distill(input.change, input.answer);
    if (!rule) return null;
    await this.store.record({
      content: rule,
      nodeTypes: input.change.nodeType ? [input.change.nodeType] : [],
      origin: 'human-answer',
      originWorkflowId: input.workflowId,
      confirmedBy: input.author ?? 'inconnu',
    });
    return rule;
  }

  /**
   * Distille un refus de porte que le modèle a corrigé lui-même.
   *
   * UNE leçon pour tout le refus, et non une par finding : les erreurs d'un même
   * brouillon sont corrélées (un nœud mal compris en produit trois), et les
   * distiller séparément écrirait trois fois la même règle à trois nuances près —
   * que la fusion ne rattraperait pas toujours.
   */
  async fromGateRefusal(event: AssistantDraftRepairedEvent): Promise<void> {
    if (!(await this.ai.isConfigured())) return;
    if (event.findings.length === 0) return;

    const nodeTypes = [
      ...new Set(event.findings.map((finding) => finding.nodeType).filter(Boolean)),
    ] as string[];
    const observed = [
      'Contrôles qui ont REFUSÉ le brouillon :',
      ...event.findings.map(
        (finding) =>
          `- [${finding.code}]${finding.nodeName ? ` sur « ${finding.nodeName} »` : ''}` +
          `${finding.nodeType ? ` (${finding.nodeType})` : ''} : ${finding.message}`,
      ),
      '',
      `Opérations refusées : ${event.refused}`,
      `Opérations qui sont passées après correction : ${event.accepted}`,
    ].join('\n');

    const rule = await this.ask(
      "Un assistant n8n a proposé une modification, des contrôles déterministes l'ont REFUSÉE, " +
        "il l'a corrigée et les mêmes contrôles passent. On te donne le refus et les deux versions.",
      observed,
    );
    if (!rule) return;
    await this.store.record({
      content: rule,
      nodeTypes,
      origin: 'gate-refusal',
      originWorkflowId: event.workflowId,
    });
  }

  private async distill(change: CorrectionChange, answer?: string): Promise<string | null> {
    const observed = [
      `Nœud : ${change.node || '(câblage)'}${change.nodeType ? ` (${change.nodeType})` : ''}`,
      change.path ? `Paramètre : ${change.path}` : '',
      `Ce que l'assistant avait écrit : ${change.wrote}`,
      `Ce que l'humain a mis à la place : ${change.fixed}`,
      `Lecture automatique : ${change.reason}`,
      answer ? `Réponse de l'humain à la question posée : ${answer}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.ask(
      'Tu formules des règles pour un assistant n8n qui vient de se faire corriger à la main. ' +
        "On te donne UN changement : ce que l'assistant avait écrit, ce que l'humain a mis.",
      observed,
    );
  }

  /**
   * L'appel de distillation, commun aux deux signaux.
   *
   * Le cadrage change (une correction humaine, un refus de porte), les impératifs
   * ne changent PAS : c'est la même exigence de dégager la règle de son cas, et
   * la même autorisation de ne rien apprendre. Deux prompts divergeraient, et
   * l'un des deux finirait par produire des règles qu'on servirait à tous les tours.
   */
  private async ask(framing: string, observed: string): Promise<string | null> {
    try {
      const result = await this.ai.generateJson<DistilledLesson>({
        system:
          framing +
          "\nTa seule tâche est de dégager la règle GÉNÉRALE que l'assistant aurait dû connaître.\n\n" +
          'Impératifs :\n' +
          `- ${MAX_LESSON_LENGTH} caractères maximum, une phrase, à l'impératif.\n` +
          '- AUCUN nom de workflow, id, url, nom de table, ni valeur propre à ce cas : une règle ' +
          'qui les contient ne servira jamais ailleurs. Le type de nœud, lui, est permis.\n' +
          "- Si ce cas n'enseigne rien de généralisable (une préférence, une valeur " +
          "métier, un choix d'humain), réponds rule: null et dis pourquoi dans why. " +
          'Ne rien apprendre est une réponse correcte et fréquente : mieux vaut un silence ' +
          "qu'une règle fausse, qu'on servira ensuite à tous les tours.\n\n" +
          'Réponds UNIQUEMENT en JSON : {"rule": "…"|null, "why": "…"}',
        prompt: observed,
        effort: 'low',
        maxTokens: 700,
      });
      if (!result.rule) {
        this.logger.debug(`Rien à apprendre de ce changement : ${result.why ?? 'sans motif'}`);
        return null;
      }
      return result.rule;
    } catch (error) {
      this.logger.warn(`Distillation impossible : ${(error as Error).message}`);
      return null;
    }
  }
}
