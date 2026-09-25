import { Module } from '@nestjs/common';
import { ModuleAdminController } from './module-admin.controller';
import { AiSettingsController } from './ai-settings.controller';
import { PlatformSettingsController } from './platform-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';

@Module({
  controllers: [ModuleAdminController, AiSettingsController, PlatformSettingsController],
  providers: [
    AiSettingsService,
    manifestProvider({
      id: 'module-admin',
      name: 'Administration des modules',
      description: 'Activation / désactivation des modules',
      core: true,
    }),
  ],
})
export class ModuleAdminModule {}
