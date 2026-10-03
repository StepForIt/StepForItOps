import { Module } from '@nestjs/common';
import { msg } from '@nwm/core';
import { InstancesController } from './instances.controller';
import { ClientsController } from './clients.controller';
import { InstancesService } from './instances.service';
import { ApiKeyHealthService } from './api-key-health.service';
import { ApiKeyExpiryCron } from './api-key-expiry.cron';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';

@Module({
  controllers: [InstancesController, ClientsController],
  providers: [
    InstancesService,
    ApiKeyHealthService,
    ApiKeyExpiryCron,
    manifestProvider({
      id: 'instances',
      get name() {
        return msg('platform.moduleInstancesName');
      },
      get description() {
        return msg('platform.moduleInstancesDescription');
      },
      core: true,
    }),
  ],
  exports: [InstancesService, ApiKeyHealthService],
})
export class InstancesModule {}
