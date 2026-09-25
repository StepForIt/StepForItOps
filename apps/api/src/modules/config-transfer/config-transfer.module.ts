import { Module } from '@nestjs/common';
import { ConfigTransferController } from './config-transfer.controller';
import { ConfigExportService } from './config-export.service';
import { ConfigImportService } from './config-import.service';
import { ConfigImportWorkflowScopedService } from './config-import-workflow-scoped.service';
import { WorkflowRefResolver } from './workflow-ref.resolver';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { CONFIG_TRANSFER_MANIFEST } from './manifest';

@Module({
  controllers: [ConfigTransferController],
  providers: [
    ConfigExportService,
    ConfigImportService,
    ConfigImportWorkflowScopedService,
    WorkflowRefResolver,
    manifestProvider(CONFIG_TRANSFER_MANIFEST),
  ],
})
export class ConfigTransferModule {}
