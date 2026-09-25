import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ModelCatalog, ModelCatalogProposal } from '@prisma/client';
import { LLM_TASKS, LLM_TASK_LABELS } from '@nwm/core';
import { ModelCatalogInput, ModelCatalogService } from './model-catalog.service';
import { ModelCatalogRefreshService, RefreshResult } from './model-catalog-refresh.service';

/**
 * Le catalogue est servi HORS module métier : éditer un tarif ne doit pas
 * dépendre de l'activation d'`ai-cost` ni de `model-audit`.
 */
@Controller('model-catalog')
export class ModelCatalogController {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly refresh: ModelCatalogRefreshService,
  ) {}

  @Get()
  async list(): Promise<{
    models: ModelCatalog[];
    freshness: { checkedAt: Date | null; ageDays: number | null };
  }> {
    const [models, freshness] = await Promise.all([this.catalog.list(), this.catalog.freshness()]);
    return { models, freshness };
  }

  @Post()
  create(@Body() input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.catalog.create(input);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.catalog.update(id, input);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.catalog.remove(id);
    return { ok: true };
  }

  @Get('proposals')
  proposals(): Promise<ModelCatalogProposal[]> {
    return this.refresh.pendingProposals();
  }

  @Post('proposals/apply')
  apply(@Body() body: { ids: string[] }): Promise<{ applied: number }> {
    return this.refresh.applyProposals(body?.ids ?? []);
  }

  @Post('proposals/reject')
  reject(@Body() body: { ids: string[] }): Promise<{ rejected: number }> {
    return this.refresh.rejectProposals(body?.ids ?? []);
  }

  /** Rafraîchissement à la demande : il produit des propositions, il n'écrit rien. */
  @Post('refresh')
  async run(): Promise<RefreshResult[]> {
    const source = await this.refresh.refreshFromSource(true);
    const ai = await this.refresh.refreshFromAi();
    return [source, ai];
  }

  /** Planchers par tâche : un arbitrage d'équipe, éditable, avec sa justification. */
  @Get('task-profiles')
  async taskProfiles() {
    const profiles = await this.catalog.taskProfiles();
    return LLM_TASKS.map((task) => ({
      task,
      label: LLM_TASK_LABELS[task],
      minTier: profiles[task] ?? 'reasoning',
    }));
  }

  @Put('task-profiles/:task')
  async setTaskProfile(
    @Param('task') task: string,
    @Body() body: { minTier: string; rationale?: string },
  ): Promise<{ ok: true }> {
    await this.catalog.setTaskProfile(task, body.minTier, body.rationale);
    return { ok: true };
  }
}
