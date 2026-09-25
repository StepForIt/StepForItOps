import { Module } from '@nestjs/common';
import { FieldCheckerController } from './field-checker.controller';
import { FieldCheckerService } from './field-checker.service';
import { ExecutionSamplerService } from './execution-sampler.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { FIELD_CHECKER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [FieldCheckerController],
  providers: [FieldCheckerService, ExecutionSamplerService, manifestProvider(FIELD_CHECKER_MANIFEST)],
})
export class FieldCheckerModule {}
