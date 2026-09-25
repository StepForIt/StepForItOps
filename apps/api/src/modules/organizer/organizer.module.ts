import { Module } from '@nestjs/common';
import { OrganizerController } from './organizer.controller';
import { OrganizerService } from './organizer.service';
import { InstancesModule } from '../instances/instances.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { ORGANIZER_MANIFEST } from './manifest';

@Module({
  imports: [InstancesModule, WorkflowsModule],
  controllers: [OrganizerController],
  providers: [OrganizerService, manifestProvider(ORGANIZER_MANIFEST)],
})
export class OrganizerModule {}
