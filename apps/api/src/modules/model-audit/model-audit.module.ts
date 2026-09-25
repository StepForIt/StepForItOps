import { Module } from '@nestjs/common';
import { ModelAuditController } from './model-audit.controller';
import { ModelAuditService } from './model-audit.service';
import { ModelAuditSettingsService } from './model-audit-settings.service';
import { LifecycleWatchService } from './lifecycle-watch.service';
import { NodeUsageService } from './node-usage.service';
import { TaskClassifierService } from './task-classifier.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { MODEL_AUDIT_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule],
  controllers: [ModelAuditController],
  providers: [
    ModelAuditService,
    ModelAuditSettingsService,
    LifecycleWatchService,
    NodeUsageService,
    TaskClassifierService,
    manifestProvider(MODEL_AUDIT_MANIFEST),
  ],
})
export class ModelAuditModule {}
