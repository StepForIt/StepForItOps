import { Module } from '@nestjs/common';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { ASSISTANT_LEARNING_MANIFEST } from './manifest';
import { AssistantLearningController } from './assistant-learning.controller';
import { CorrectionCaptureService } from './correction-capture.service';
import { GateRefusalService } from './gate-refusal.service';
import { LessonDistillService } from './lesson-distill.service';
import { LessonStoreService } from './lesson-store.service';
import { PendingQuestionService } from './pending-question.service';

@Module({
  controllers: [AssistantLearningController],
  providers: [
    CorrectionCaptureService,
    GateRefusalService,
    LessonDistillService,
    LessonStoreService,
    PendingQuestionService,
    manifestProvider(ASSISTANT_LEARNING_MANIFEST),
  ],
})
export class AssistantLearningModule {}
