import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { FindingsController } from './findings.controller';
import { FindingIgnoreController } from './finding-ignore.controller';
import { FindingIgnoreService } from './finding-ignore.service';
import { WorkflowsService } from './workflows.service';
import { WorkflowFamiliesService } from './workflow-families.service';
import { WorkflowDivergenceService } from './workflow-divergence.service';
import { WorkflowDivergenceDetailService } from './workflow-divergence-detail.service';
import { WorkflowSyncService } from './workflow-sync.service';
import { WorkflowSearchSyncService } from './workflow-search-sync.service';
import { WorkflowCreateService } from './workflow-create.service';
import { WorkflowSyncCron } from './workflow-sync.cron';
import { WorkflowArchiveService } from './workflow-archive.service';
import { WorkflowPublishService } from './workflow-publish.service';
import { WorkflowViewService } from './workflow-view.service';
import { WorkflowExportService } from './workflow-export.service';
import { TimeSavedService } from './time-saved.service';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';

@Module({
  imports: [InstancesModule],
  controllers: [WorkflowsController, FindingsController, FindingIgnoreController],
  providers: [
    WorkflowsService,
    WorkflowFamiliesService,
    WorkflowDivergenceService,
    WorkflowDivergenceDetailService,
    WorkflowSyncService,
    WorkflowSearchSyncService,
    WorkflowCreateService,
    WorkflowSyncCron,
    WorkflowArchiveService,
    WorkflowPublishService,
    WorkflowViewService,
    WorkflowExportService,
    TimeSavedService,
    FindingIgnoreService,
    manifestProvider({
      id: 'workflows',
      name: 'Workflows',
      description: 'Miroir local des workflows + synchronisation',
      core: true,
    }),
  ],
  exports: [WorkflowsService, WorkflowSyncService, WorkflowCreateService, FindingIgnoreService],
})
export class WorkflowsModule {}
