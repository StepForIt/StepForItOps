import { Module } from '@nestjs/common';
import { TesterController } from './tester.controller';
import { TesterService } from './tester.service';
import { TestCasesService } from './test-cases.service';
import { MockPlanService } from './mock-plan.service';
import { NodeBenchPreviewService } from './node-bench-preview.service';
import { NodeBenchService } from './node-bench.service';
import { WebhookTargetService } from './webhook-target.service';
import { WorkflowRefreshService } from './workflow-refresh.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { TESTER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [TesterController],
  providers: [
    TesterService,
    TestCasesService,
    MockPlanService,
    NodeBenchPreviewService,
    NodeBenchService,
    WebhookTargetService,
    WorkflowRefreshService,
    manifestProvider(TESTER_MANIFEST),
  ],
})
export class TesterModule {}
