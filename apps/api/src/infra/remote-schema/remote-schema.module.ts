import { Global, Module } from '@nestjs/common';
import { RemoteSchemaReaderService } from './remote-schema-reader.service';
import { RemoteSchemaCheckService } from './remote-schema-check.service';

/** Global : l'écran du workflow et la promotion jouent le même contrôle sans import croisé. */
@Global()
@Module({
  providers: [RemoteSchemaReaderService, RemoteSchemaCheckService],
  exports: [RemoteSchemaCheckService],
})
export class RemoteSchemaInfraModule {}
