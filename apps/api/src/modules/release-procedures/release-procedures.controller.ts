import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { GestureInput } from '@nwm/core';
import { withTotalCount } from '../../common/crud/paginate';
import {
  CaptureInput,
  DuplicateInput,
  InsertInput,
  ProcedureRow,
  ProcedureStepRow,
  ReleaseProceduresService,
  StepPatch,
} from './release-procedures.service';

/** Sans session (dev local, `AUTH_OPTIONAL`), tout le monde enregistre sous le même nom. */
const who = (email?: string): string => email?.trim() || 'local';

@ModuleId('release-procedures')
@Controller('release-procedures')
export class ReleaseProceduresController {
  constructor(private readonly procedures: ReleaseProceduresService) {}

  @Get()
  async list(@Res({ passthrough: true }) res: Response): Promise<ProcedureRow[]> {
    const rows = await this.procedures.list();
    return withTotalCount(res, rows.length, rows);
  }

  @Get('recording')
  async recording(@Headers('x-user-email') email?: string): Promise<{ procedure: ProcedureRow | null }> {
    return { procedure: await this.procedures.active(who(email)) };
  }

  @Post('recording')
  start(@Body() body: { name: string }, @Headers('x-user-email') email?: string): Promise<ProcedureRow> {
    return this.procedures.start(body.name, who(email));
  }

  /** Appelé par le navigateur après chaque écriture réussie, tant qu'un enregistrement tourne. */
  @Post('recording/capture')
  capture(
    @Body() body: CaptureInput,
    @Headers('x-user-email') email?: string,
  ): Promise<{ captured: boolean; step?: ProcedureStepRow }> {
    return this.procedures.capture(who(email), body);
  }

  @Get('resolve')
  resolve(
    @Query('familyKey') familyKey: string,
    @Query('env') env: string,
  ): Promise<{ workflowId: string; active: boolean }> {
    return this.procedures.resolve(familyKey, env);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProcedureRow> {
    return this.procedures.get(id);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { name: string }): Promise<ProcedureRow> {
    return this.procedures.rename(id, body.name);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string): Promise<ProcedureRow> {
    return this.procedures.stop(id);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id') id: string,
    @Body() body: DuplicateInput,
    @Headers('x-user-email') email?: string,
  ): Promise<ProcedureRow> {
    return this.procedures.duplicate(id, body, who(email));
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.procedures.remove(id);
  }

  @Post(':id/steps')
  addManual(
    @Param('id') id: string,
    @Body() body: InsertInput & { label: string },
  ): Promise<ProcedureStepRow> {
    return this.procedures.addManual(id, body);
  }

  @Post(':id/steps/gesture')
  addGesture(@Param('id') id: string, @Body() body: InsertInput & GestureInput): Promise<ProcedureStepRow> {
    return this.procedures.addGesture(id, body);
  }

  /** L'ordre COMPLET des étapes ; `frozen` protège celles qu'un rejeu a déjà jouées. */
  @Put(':id/steps/order')
  reorder(
    @Param('id') id: string,
    @Body() body: { order: string[]; frozen?: number },
  ): Promise<ProcedureRow> {
    return this.procedures.reorder(id, body);
  }

  @Patch(':id/steps/:stepId')
  updateStep(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: StepPatch,
  ): Promise<ProcedureStepRow> {
    return this.procedures.updateStep(id, stepId, body);
  }

  /** Refait le geste d'une étape automatique ; `frozen` protège celles qu'un rejeu a déjà jouées. */
  @Put(':id/steps/:stepId/gesture')
  updateGesture(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: GestureInput & { frozen?: number; note?: string | null },
  ): Promise<ProcedureStepRow> {
    return this.procedures.updateGesture(id, stepId, body);
  }

  @Delete(':id/steps/:stepId')
  removeStep(@Param('id') id: string, @Param('stepId') stepId: string): Promise<{ id: string }> {
    return this.procedures.removeStep(id, stepId);
  }
}
