import { Global, Module } from '@nestjs/common';
import { EnvChainGuardService } from './env-chain-guard.service';
import { PlatformSettingsService } from './platform-settings.service';

/** Global : réglages transverses (filtre des archivés, chaîne d'envs) sans import. */
@Global()
@Module({
  providers: [PlatformSettingsService, EnvChainGuardService],
  exports: [PlatformSettingsService, EnvChainGuardService],
})
export class PlatformSettingsModule {}
