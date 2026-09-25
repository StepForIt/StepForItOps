import { Injectable, Logger } from '@nestjs/common';
import {
  AssistantLesson,
  EVENTS,
  N8nWorkflow,
  isStickyNote,
  recallLessons,
  renderLessonBrief,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';

/** Ce qu'on ajoute au contexte d'un tour au titre de ce que l'assistant a appris. */
export interface RecalledLearning {
  /** Les règles à servir, déjà bornées et rendues. `null` s'il n'y en a aucune. */
  brief: string | null;
  /** La question en suspens sur une correction humaine, à poser dans la réponse. */
  question: { id: string; text: string } | null;
}

/**
 * Sert au tour ce que l'assistant a appris, et lui rappelle la question qu'il
 * doit à l'humain.
 *
 * Lecture DIRECTE des tables d'`assistant-learning`, jamais ses services : c'est
 * un module métier désactivable, et la règle d'architecture interdit de
 * l'importer (même précédent que `restore-point.service.ts` pour `versioning`, ou
 * que `dashboard` pour tout le monde). Le rappel ne peut pas passer par un
 * événement : il est synchrone, dans le tour, et un événement ne rend rien.
 *
 * Ce qui est servi est BORNÉ dur, et c'est le point : le corpus peut grossir
 * autant qu'il veut, six règles au plus atteignent le prompt. C'est ce qui
 * distingue ce mécanisme du bloc « PIÈGES n8n » écrit à la main dans
 * `chat-prompt.ts`, qui lui est payé en entier à chaque tour et pour toujours.
 */
@Injectable()
export class LessonRecallService {
  private readonly logger = new Logger(LessonRecallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly bus: EventBusService,
  ) {}

  async recall(input: { workflowId: string; raw: N8nWorkflow; question: string }): Promise<RecalledLearning> {
    if (!(await this.registry.isEnabled('assistant-learning'))) {
      return { brief: null, question: null };
    }
    try {
      const [lessons, pending] = await Promise.all([
        this.prisma.assistantLesson.findMany({ where: { status: 'active' } }),
        this.prisma.assistantCorrection.findFirst({
          where: { workflowId: input.workflowId, status: 'pending', question: { not: null } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const nodeTypes = [
        ...new Set((input.raw.nodes ?? []).filter((node) => !isStickyNote(node)).map((node) => node.type)),
      ];
      const picked = recallLessons(
        lessons.map((row): AssistantLesson => ({
          id: row.id,
          content: row.content,
          nodeTypes: row.nodeTypes,
          keywords: row.keywords,
          status: row.status as AssistantLesson['status'],
          occurrences: row.occurrences,
          recalls: row.recalls,
          origin: row.origin as AssistantLesson['origin'],
        })),
        { nodeTypes, question: input.question },
      );

      if (picked.length > 0) {
        await this.prisma.assistantLesson.updateMany({
          where: { id: { in: picked.map((lesson) => lesson.id) } },
          data: { recalls: { increment: 1 }, lastRecallAt: new Date() },
        });
      }

      return {
        brief: renderLessonBrief(picked),
        question: pending?.question ? { id: pending.id, text: pending.question } : null,
      };
    } catch (error) {
      // Les leçons sont un bonus : leur absence ne doit jamais couper une conversation.
      this.logger.warn(`Rappel des leçons impossible : ${(error as Error).message}`);
      return { brief: null, question: null };
    }
  }

  /**
   * Recueille la réponse de l'humain et la passe à qui sait en tirer une règle.
   *
   * Rien n'est écrit ici : `workflow-chat` recueille, `assistant-learning`
   * apprend. Un module métier n'appelle jamais le service d'un autre, et
   * l'événement est justement le chemin prévu pour ça — d'autant qu'il n'y a
   * rien à attendre en retour, la distillation coûtant un appel IA.
   */
  async answerPending(input: {
    workflowId: string;
    answer: string;
    author?: string | null;
  }): Promise<{ recorded: boolean; reason?: string }> {
    if (!(await this.registry.isEnabled('assistant-learning'))) {
      return { recorded: false, reason: "le module d'apprentissage est désactivé" };
    }
    const pending = await this.prisma.assistantCorrection.findFirst({
      where: { workflowId: input.workflowId, status: 'pending', question: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return { recorded: false, reason: 'aucune correction en attente sur ce workflow' };

    this.bus.emit(EVENTS.assistantCorrectionAnswered, {
      correctionId: pending.id,
      workflowId: input.workflowId,
      answer: input.answer,
      author: input.author ?? null,
    });
    return { recorded: true };
  }
}
