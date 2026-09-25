import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { REMOTE_SCHEMA_MANIFEST } from './manifest';
import { RemoteSchemaController } from './remote-schema.controller';
import { RemoteSchemaService } from './remote-schema.service';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [RemoteSchemaController],
  providers: [RemoteSchemaService, manifestProvider(REMOTE_SCHEMA_MANIFEST)],
})
export class RemoteSchemaModule {}
