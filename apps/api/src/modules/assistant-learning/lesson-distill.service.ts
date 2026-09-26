import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  AssistantDraftRepairedEvent,
  CorrectionChange,
  MAX_LESSON_LENGTH,
  writeInLanguage,
} from '@nwm/core';
import { PlatformLocale } from '../../infra/i18n/platform-locale';
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
    private readonly platformLocale: PlatformLocale,
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
      confirmedBy: input.author ?? 'unknown',
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
      'Checks that REFUSED the draft:',
      ...event.findings.map(
        (finding) =>
          `- [${finding.code}]${finding.nodeName ? ` on "${finding.nodeName}"` : ''}` +
          `${finding.nodeType ? ` (${finding.nodeType})` : ''}: ${finding.message}`,
      ),
      '',
      `Refused operations: ${event.refused}`,
      `Operations that passed after the fix: ${event.accepted}`,
    ].join('\n');

    const rule = await this.ask(
      'An n8n assistant proposed a change, deterministic checks REFUSED it, ' +
        'it fixed it and the same checks now pass. You are given the refusal and both versions.',
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
      `Node: ${change.node || '(wiring)'}${change.nodeType ? ` (${change.nodeType})` : ''}`,
      change.path ? `Parameter: ${change.path}` : '',
      `What the assistant had written: ${change.wrote}`,
      `What the human put instead: ${change.fixed}`,
      `Automatic reading: ${change.reason}`,
      answer ? `Human's answer to the question asked: ${answer}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.ask(
      'You write rules for an n8n assistant that has just been corrected by hand. ' +
        'You are given ONE change: what the assistant had written, what the human put instead.',
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
    // La leçon est persistée et servie à tous : elle s'écrit dans la langue de la
    // plateforme, même quand la réponse d'un humain l'a déclenchée depuis sa console.
    const language = this.platformLocale.run(() => writeInLanguage());
    try {
      const result = await this.ai.generateJson<DistilledLesson>({
        system:
          framing +
          '\nYour only task is to extract the GENERAL rule the assistant should have known.\n\n' +
          'Requirements:\n' +
          `- ${MAX_LESSON_LENGTH} characters maximum, one sentence, in the imperative.\n` +
          '- NO workflow name, id, url, table name, or value specific to this case: a rule ' +
          'that contains them will never be useful elsewhere. The node type, however, is allowed.\n' +
          '- If this case teaches nothing generalizable (a preference, a business ' +
          "value, a human's choice), answer rule: null and say why in why. " +
          'Learning nothing is a correct and frequent answer: silence is better ' +
          'than a wrong rule, which would then be served on every turn.\n' +
          `- ${language}\n\n` +
          'Answer ONLY in JSON: {"rule": "…"|null, "why": "…"}',
        prompt: observed,
        effort: 'low',
        maxTokens: 700,
      });
      if (!result.rule) {
        this.logger.debug(`Nothing to learn from this change: ${result.why ?? 'no reason given'}`);
        return null;
      }
      return result.rule;
    } catch (error) {
      this.logger.warn(`Distillation failed: ${(error as Error).message}`);
      return null;
    }
  }
}
