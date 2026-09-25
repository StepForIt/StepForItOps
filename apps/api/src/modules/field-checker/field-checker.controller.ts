import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FieldCheckResult, FieldCheckerService } from './field-checker.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { FIELD_CHECKER_MANIFEST } from './manifest';

@ModuleId(FIELD_CHECKER_MANIFEST.id)
@Controller('field-checker')
export class FieldCheckerController {
  constructor(private readonly checker: FieldCheckerService) {}

  /** Analyse : échantillonne les dernières exécutions puis persiste les findings. */
  @Post('run/:workflowId')
  run(
    @Param('workflowId') workflowId: string,
    @Query('limit') limit?: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<FieldCheckResult> {
    return this.checker.check(workflowId, limit ? Number(limit) : undefined, body?.disabled);
  }

  /** Schéma observé par nœud, sans rien persister. */
  @Get('samples/:workflowId')
  samples(
    @Param('workflowId') workflowId: string,
    @Query('limit') limit?: string,
  ): Promise<FieldCheckResult> {
    return this.checker.samplesOf(workflowId, limit ? Number(limit) : undefined);
  }
}
