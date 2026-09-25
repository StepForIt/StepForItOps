import { Module } from '@nestjs/common';
import { OptimizerController } from './optimizer.controller';
import { OptimizerService } from './optimizer.service';
import { StickySuggestionsService } from './sticky-suggestions.service';
import { MakeNamingService } from './make-naming.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { OPTIMIZER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [OptimizerController],
  providers: [
    OptimizerService,
    MakeNamingService,
    StickySuggestionsService,
    manifestProvider(OPTIMIZER_MANIFEST),
  ],
})
export class OptimizerModule {}
