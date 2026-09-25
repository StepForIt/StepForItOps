import { Module } from '@nestjs/common';
import { VersioningController } from './versioning.controller';
import { VersioningService } from './versioning.service';
import { VersionExportService } from './version-export.service';
import { VersionPreviewService } from './version-preview.service';
import { VersionHistoryService } from './version-history.service';
import { VersionFamiliesService } from './version-families.service';
import { ExportCleanupService } from './export-cleanup.service';
import { ExportArchiveService } from './export-archive.service';
import { ExportTargetsService } from './export-targets.service';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { VERSIONING_MANIFEST } from './manifest';

@Module({
  imports: [InstancesModule],
  controllers: [VersioningController],
  providers: [
    VersioningService,
    VersionExportService,
    VersionPreviewService,
    VersionHistoryService,
    VersionFamiliesService,
    ExportCleanupService,
    ExportArchiveService,
    ExportTargetsService,
    manifestProvider(VERSIONING_MANIFEST),
  ],
})
export class VersioningModule {}
