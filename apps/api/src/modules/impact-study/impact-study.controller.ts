import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { ImpactStudy, ImpactStudyService, ProcedureImpactStudy } from './impact-study.service';

@ModuleId('impact-study')
@Controller('impact-study')
export class ImpactStudyController {
  constructor(private readonly study: ImpactStudyService) {}

  @Get('workflows/:id')
  workflow(@Param('id') id: string): Promise<ImpactStudy> {
    return this.study.studyWorkflows([id]);
  }

  /** Les actions groupées : un lot de workflows cochés. */
  @Post('workflows')
  workflows(@Body() body: { ids?: string[] }): Promise<ImpactStudy> {
    return this.study.studyWorkflows(Array.isArray(body?.ids) ? body.ids : []);
  }

  /** `sourceEnv` / `targetEnv` : le saut du rejeu ; absents, le saut enregistré. */
  @Get('procedures/:id')
  procedure(
    @Param('id') id: string,
    @Query('sourceEnv') sourceEnv?: string,
    @Query('targetEnv') targetEnv?: string,
  ): Promise<ProcedureImpactStudy> {
    return this.study.studyProcedure(id, { source: sourceEnv, target: targetEnv });
  }
}
