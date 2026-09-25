import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { Finding } from '@prisma/client';
import { VerifierService } from './verifier.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('verifier')
@Controller('verifier')
export class VerifierController {
  constructor(private readonly verifier: VerifierService) {}

  /**
   * POST /verifier/run/:workflowId?ai=1, corps optionnel `{ disabled: string[] }`
   * — les contrôles décochés dans l'écran de lancement, avant tout enregistrement.
   */
  @Post('run/:workflowId')
  run(
    @Param('workflowId') workflowId: string,
    @Query('ai') ai?: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<Finding[]> {
    return this.verifier.verify(workflowId, ai === '1' || ai === 'true', body?.disabled);
  }
}
