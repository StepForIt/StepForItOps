import { Module } from '@nestjs/common';
import { DocSchemaController } from './doc-schema.controller';
import { DocSchemaService } from './doc-schema.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { DOC_SCHEMA_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule],
  controllers: [DocSchemaController],
  providers: [DocSchemaService, manifestProvider(DOC_SCHEMA_MANIFEST)],
})
export class DocSchemaModule {}
