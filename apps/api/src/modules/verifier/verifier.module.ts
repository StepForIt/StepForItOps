import { Module } from '@nestjs/common';
import { VerifierController } from './verifier.controller';
import { VerifierService } from './verifier.service';
import { AiLogicReviewService } from './ai-logic-review.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { VERIFIER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule],
  controllers: [VerifierController],
  providers: [VerifierService, AiLogicReviewService, manifestProvider(VERIFIER_MANIFEST)],
})
export class VerifierModule {}
