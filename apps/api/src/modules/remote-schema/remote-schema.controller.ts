import { Body, Controller, Param, Post } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { REMOTE_SCHEMA_MANIFEST } from './manifest';
import { RemoteSchemaRunResult, RemoteSchemaService } from './remote-schema.service';

@ModuleId(REMOTE_SCHEMA_MANIFEST.id)
@Controller('remote-schema')
export class RemoteSchemaController {
  constructor(private readonly service: RemoteSchemaService) {}

  /** Lit les tables du workflow sur son instance, puis persiste les findings. */
  @Post('run/:workflowId')
  run(
    @Param('workflowId') workflowId: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<RemoteSchemaRunResult> {
    return this.service.run(workflowId, body?.disabled);
  }
}
