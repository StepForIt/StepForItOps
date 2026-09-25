import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { ClientsController } from './clients.controller';
import { InstancesService } from './instances.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';

@Module({
  controllers: [InstancesController, ClientsController],
  providers: [
    InstancesService,
    manifestProvider({
      id: 'instances',
      name: 'Instances n8n',
      description: 'Connexion aux instances n8n (dev/preprod/prod)',
      core: true,
    }),
  ],
  exports: [InstancesService],
})
export class InstancesModule {}
