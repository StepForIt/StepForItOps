import { Module } from '@nestjs/common';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { WORKFLOW_GROUPS_MANIFEST } from './manifest';
import { WorkflowGroupsController } from './workflow-groups.controller';
import { WorkflowGroupsService } from './workflow-groups.service';

@Module({
  controllers: [WorkflowGroupsController],
  providers: [WorkflowGroupsService, manifestProvider(WORKFLOW_GROUPS_MANIFEST)],
})
export class WorkflowGroupsModule {}
