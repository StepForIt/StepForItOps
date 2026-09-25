import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowDoc } from '@prisma/client';
import { DocSchemaService } from './doc-schema.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('doc-schema')
@Controller('doc-schema')
export class DocSchemaController {
  constructor(private readonly docs: DocSchemaService) {}

  @Post('generate/:workflowId')
  generate(@Param('workflowId') workflowId: string, @Query('ai') ai?: string): Promise<WorkflowDoc> {
    return this.docs.generate(workflowId, ai === '1' || ai === 'true');
  }

  @Get(':workflowId')
  get(@Param('workflowId') workflowId: string): Promise<WorkflowDoc | null> {
    return this.docs.get(workflowId);
  }
}
