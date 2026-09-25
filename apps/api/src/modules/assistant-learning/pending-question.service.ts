import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AssistantCorrection } from '@prisma/client';
import { AssistantCorrectionAnsweredEvent, CorrectionChange, EVENTS } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LessonDistillService } from './lesson-distill.service';

/**
 * La question qu'on doit à l'humain, et ce qu'on fait de sa réponse.
 *
 * C'est le troisième discriminant, celui qui rattrape ce que le déterminisme ne
 * sait pas trancher : un nœud ajouté à la main, un câblage refait, un gabarit
 * remplacé. Le diff ne dit pas si l'assistant s'est trompé ou si l'humain a
 * changé d'avis — et les deux ont exactement la même forme.
 *
 * Une seule question à la fois, et jamais relancée : on demande pour apprendre,
 * pas pour faire remplir un formulaire. Une question ignorée deux fois est une
 * question qui ne valait pas d'être posée.
 */
@Injectable()
export class PendingQuestionService {
  private readonly logger = new Logger(PendingQuestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly distill: LessonDistillService,
  ) {}

  /** La question en attente sur ce workflow, s'il y en a une. */
  pending(workflowId: string): Promise<AssistantCorrection | null> {
    return this.prisma.assistantCorrection.findFirst({
      where: { workflowId, status: 'pending', question: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Enregistre la réponse et en tire une règle, active d'emblée.
   *
   * La correction passe à `answered` quoi qu'il arrive — y compris quand la
   * distillation ne produit rien. Une question à laquelle on a répondu ne se
   * repose pas, même si la réponse n'a rien appris.
   */
  async answer(input: {
    correctionId: string;
    answer: string;
    author?: string | null;
  }): Promise<{ learned: string | null }> {
    const correction = await this.prisma.assistantCorrection.findUnique({
      where: { id: input.correctionId },
    });
    if (!correction || correction.status !== 'pending') return { learned: null };

    const changes = (correction.changes as unknown as CorrectionChange[]) ?? [];
    const asked = changes.find((change) => change.verdict === 'ask');

    let learned: string | null = null;
    if (asked) {
      learned = await this.distill.fromAnswer({
        workflowId: correction.workflowId,
        change: asked,
        answer: input.answer,
        author: input.author,
      });
    }

    await this.prisma.assistantCorrection.update({
      where: { id: correction.id },
      data: { status: 'answered', answer: input.answer, answeredAt: new Date() },
    });
    this.logger.log(
      `Question de correction répondue (${correction.id}) — ${learned ? 'règle apprise' : 'rien appris'}`,
    );
    return { learned };
  }

  /**
   * L'assistant vient de recueillir la réponse dans la conversation.
   *
   * Même chemin que la réponse donnée depuis la page : c'est la même chose, et
   * deux implémentations divergeraient. L'échec est avalé — apprendre est un
   * bonus, et une distillation qui rate ne doit pas remonter dans le tour de
   * chat qui a émis l'événement.
   */
  @OnEvent(EVENTS.assistantCorrectionAnswered)
  async onAnswered(event: AssistantCorrectionAnsweredEvent): Promise<void> {
    try {
      await this.answer({
        correctionId: event.correctionId,
        answer: event.answer,
        author: event.author,
      });
    } catch (error) {
      this.logger.warn(`Réponse non exploitée (${event.correctionId}) : ${(error as Error).message}`);
    }
  }

  /** L'humain ne veut pas répondre : la question se ferme sans rien apprendre. */
  async dismiss(correctionId: string): Promise<{ ok: true }> {
    await this.prisma.assistantCorrection.update({
      where: { id: correctionId },
      data: { status: 'resolved' },
    });
    return { ok: true };
  }

  list(workflowId?: string): Promise<AssistantCorrection[]> {
    return this.prisma.assistantCorrection.findMany({
      where: workflowId ? { workflowId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
