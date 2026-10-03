import { Module } from '@nestjs/common';
import { ConfigTransferController } from './config-transfer.controller';
import { ConfigExportService } from './config-export.service';
import { ConfigImportService } from './config-import.service';
import { ConfigImportWorkflowScopedService } from './config-import-workflow-scoped.service';
import { ConfigImportSyncService } from './config-import-sync.service';
import { WorkflowRefResolver } from './workflow-ref.resolver';
import { FullBackupExportService } from './backup/full-backup-export.service';
import { FullBackupRestoreService } from './backup/full-backup-restore.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { CONFIG_TRANSFER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule],
  controllers: [ConfigTransferController],
  providers: [
    ConfigExportService,
    ConfigImportService,
    ConfigImportWorkflowScopedService,
    ConfigImportSyncService,
    WorkflowRefResolver,
    FullBackupExportService,
    FullBackupRestoreService,
    manifestProvider(CONFIG_TRANSFER_MANIFEST),
  ],
})
export class ConfigTransferModule {}
