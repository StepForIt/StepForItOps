import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTokenGuard } from './common/auth/api-token.guard';
import { LoggingModule } from './infra/logging/logging.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { PlatformSettingsModule } from './infra/settings/platform-settings.module';
import { AuthSettingsModule } from './infra/auth-settings/auth-settings.module';
import { CheckProfilesModule } from './infra/check-profiles/check-profiles.module';
import { NodeCatalogModule } from './infra/node-catalog/node-catalog.module';
import { ModelCatalogModule } from './infra/model-catalog/model-catalog.module';
import { ResourceLabelsModule } from './infra/resource-labels/resource-labels.module';
import { N8nProbeModule } from './infra/n8n-probe/n8n-probe.module';
import { RemoteSchemaInfraModule } from './infra/remote-schema/remote-schema.module';
import { WorkflowLockModule } from './infra/workflow-lock/workflow-lock.module';
import { I18nModule } from './infra/i18n/i18n.module';
import { AdaptersModule } from './infra/adapters/adapters.module';
import { EventBusModule } from './infra/events/event-bus.module';
import { ModuleRegistryModule } from './infra/modules-registry/module-registry.module';
import { ModuleEnabledGuard } from './infra/modules-registry/module-enabled.guard';
import { loadFeatureModules } from './infra/modules-registry/modules.loader';
import { InstancesModule } from './modules/instances/instances.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ModuleAdminModule } from './modules/module-admin/module-admin.module';

@Module({})
export class AppModule {
  static register(featureModules: DynamicModule['imports']): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        LoggingModule,
        PrismaModule,
        PlatformSettingsModule,
        I18nModule,
        AuthSettingsModule,
        CheckProfilesModule,
        NodeCatalogModule,
        ModelCatalogModule,
        ResourceLabelsModule,
        N8nProbeModule,
        RemoteSchemaInfraModule,
        WorkflowLockModule,
        EventBusModule,
        AdaptersModule,
        ModuleRegistryModule,
        // Modules core (non désactivables)
        InstancesModule,
        WorkflowsModule,
        ModuleAdminModule,
        // Modules métier chargés dynamiquement
        ...(featureModules ?? []),
      ],
      providers: [
        // Accès à l'API (jeton partagé avec le front) avant l'activation du module.
        { provide: APP_GUARD, useClass: ApiTokenGuard },
        { provide: APP_GUARD, useClass: ModuleEnabledGuard },
      ],
    };
  }
}

export async function buildAppModule(): Promise<DynamicModule> {
  const featureModules = await loadFeatureModules();
  return AppModule.register(featureModules);
}
