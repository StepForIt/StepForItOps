import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { Finding } from '@prisma/client';
import { JsCheckerService } from './js-checker.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('js-checker')
@Controller('js-checker')
export class JsCheckerController {
  constructor(private readonly checker: JsCheckerService) {}

  /** Corps optionnel `{ disabled: string[] }` : contrôles décochés pour ce lancement. */
  @Post('run/:workflowId')
  run(
    @Param('workflowId') workflowId: string,
    @Query('ai') ai?: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<Finding[]> {
    return this.checker.check(workflowId, ai === '1' || ai === 'true', body?.disabled);
  }
}
