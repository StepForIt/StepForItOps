import { Module } from '@nestjs/common';
import { AiCostController } from './ai-cost.controller';
import { AiCostService } from './ai-cost.service';
import { BudgetAlertService } from './budget-alert.service';
import { LlmUsageSamplerService } from './llm-usage-sampler.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { AI_COST_MANIFEST } from './manifest';

@Module({
  controllers: [AiCostController],
  providers: [AiCostService, BudgetAlertService, LlmUsageSamplerService, manifestProvider(AI_COST_MANIFEST)],
})
export class AiCostModule {}
