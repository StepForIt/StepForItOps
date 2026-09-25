import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AssistantCorrection, AssistantLesson } from '@prisma/client';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { LessonStoreService } from './lesson-store.service';
import { PendingQuestionService } from './pending-question.service';

/**
 * Ce que l'assistant a appris, relisible et corrigible.
 *
 * Une leçon fausse est le vrai risque d'un assistant qui apprend seul : elle se
 * sert à tous les tours, avec le même aplomb qu'une vraie, et rien dans une
 * conversation ne dit d'où elle vient. La page est donc le pendant obligatoire de
 * la capture — comme la mémoire de `workflow-chat`, exposée en lecture ET en
 * écriture pour la même raison.
 */
@ModuleId('assistant-learning')
@Controller('assistant-learning')
export class AssistantLearningController {
  constructor(
    private readonly lessons: LessonStoreService,
    private readonly questions: PendingQuestionService,
  ) {}

  @Get('lessons')
  listLessons(): Promise<AssistantLesson[]> {
    return this.lessons.list();
  }

  /** Corriger une formulation, activer une candidate, retirer une règle fausse. */
  @Patch('lessons/:id')
  updateLesson(
    @Param('id') id: string,
    @Body() body: { content?: string; status?: 'candidate' | 'active' | 'retired' },
  ): Promise<AssistantLesson> {
    return this.lessons.update(id, body);
  }

  @Delete('lessons/:id')
  removeLesson(@Param('id') id: string): Promise<{ ok: true }> {
    return this.lessons.remove(id);
  }

  /** Les corrections lues, répondues ou non : la trace de ce qu'on a su en tirer. */
  @Get('corrections')
  listCorrections(@Query('workflowId') workflowId?: string): Promise<AssistantCorrection[]> {
    return this.questions.list(workflowId);
  }

  @Post('corrections/:id/answer')
  answer(
    @Param('id') id: string,
    @Body() body: { answer: string; author?: string },
  ): Promise<{ learned: string | null }> {
    return this.questions.answer({ correctionId: id, answer: body.answer, author: body.author });
  }

  @Post('corrections/:id/dismiss')
  dismiss(@Param('id') id: string): Promise<{ ok: true }> {
    return this.questions.dismiss(id);
  }
}
