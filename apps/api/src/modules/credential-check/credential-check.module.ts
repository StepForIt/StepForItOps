import { Module } from '@nestjs/common';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { CREDENTIAL_CHECK_MANIFEST } from './manifest';
import { CredentialCheckController } from './credential-check.controller';
import { CredentialCheckService } from './credential-check.service';
import { CredentialCheckSettingsService } from './credential-check-settings.service';
import { CredentialWatchService } from './credential-watch.service';

@Module({
  imports: [InstancesModule],
  controllers: [CredentialCheckController],
  providers: [
    CredentialCheckService,
    CredentialCheckSettingsService,
    CredentialWatchService,
    manifestProvider(CREDENTIAL_CHECK_MANIFEST),
  ],
})
export class CredentialCheckModule {}
