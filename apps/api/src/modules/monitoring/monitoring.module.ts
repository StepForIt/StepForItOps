import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringSettingsController } from './monitoring-settings.controller';
import { ErrorHistoryController } from './error-history.controller';
import { ErrorGroupsController } from './error-groups.controller';
import { HeartbeatService } from './heartbeat.service';
import { ActiveCheckService } from './active-check.service';
import { ErrorWatchService } from './error-watch.service';
import { ErrorHistoryService } from './error-history.service';
import { ErrorStatsService } from './error-stats.service';
import { ErrorGroupService } from './error-group.service';
import { MonitoringChecklistService } from './monitoring-checklist.service';
import { KumaProvisioningService } from './kuma-provisioning.service';
import { KumaImportService } from './kuma-import.service';
import { KumaRedundancyService } from './kuma-redundancy.service';
import { MonitoringSettingsService } from './monitoring-settings.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { MONITORING_MANIFEST } from './manifest';

@Module({
  controllers: [
    MonitoringController,
    MonitoringSettingsController,
    ErrorHistoryController,
    ErrorGroupsController,
  ],
  providers: [
    HeartbeatService,
    ActiveCheckService,
    ErrorWatchService,
    ErrorHistoryService,
    ErrorStatsService,
    ErrorGroupService,
    MonitoringChecklistService,
    KumaProvisioningService,
    KumaImportService,
    KumaRedundancyService,
    MonitoringSettingsService,
    manifestProvider(MONITORING_MANIFEST),
  ],
})
export class MonitoringModule {}
