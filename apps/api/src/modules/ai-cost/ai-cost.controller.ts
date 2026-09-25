import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ModelCatalog } from '@prisma/client';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { AI_COST_MANIFEST } from './manifest';
import { AiCostService, AiCostSummary, ExecutionCost } from './ai-cost.service';
import { BudgetAlertService, BudgetSettings } from './budget-alert.service';
import { LlmSampleResult, LlmUsageSamplerService } from './llm-usage-sampler.service';
import { ModelCatalogInput, ModelCatalogService } from '../../infra/model-catalog/model-catalog.service';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
const DEFAULT_EXECUTIONS_DAYS = 30;

@ModuleId(AI_COST_MANIFEST.id)
@Controller('ai-cost')
export class AiCostController {
  constructor(
    private readonly costs: AiCostService,
    private readonly sampler: LlmUsageSamplerService,
    private readonly prices: ModelCatalogService,
    private readonly budget: BudgetAlertService,
  ) {}

  /** Budget quotidien (USD) : null = pas d'alerte. */
  @Get('budget')
  budgetSettings(): Promise<BudgetSettings> {
    return this.budget.settings();
  }

  @Put('budget')
  updateBudget(@Body() input: BudgetSettings): Promise<BudgetSettings> {
    return this.budget.updateSettings(input);
  }

  /** Synthèse : totaux, par workflow, par modèle et par jour sur la fenêtre. */
  @Get('summary')
  summary(@Query('instanceId') instanceId?: string, @Query('days') days?: string): Promise<AiCostSummary> {
    return this.costs.summary(instanceId, clampDays(days, DEFAULT_DAYS));
  }

  /** Coût agrégé d'un workflow (id plateforme) — l'encart de sa page de détail. */
  @Get('workflow/:workflowId')
  workflow(@Param('workflowId') workflowId: string, @Query('days') days?: string) {
    return this.costs.workflowSummary(workflowId, clampDays(days, DEFAULT_EXECUTIONS_DAYS));
  }

  /** Coût par exécution d'un workflow (drill-down d'une ligne de la table). */
  @Get('executions/:instanceId/:externalWorkflowId')
  executions(
    @Param('instanceId') instanceId: string,
    @Param('externalWorkflowId') externalWorkflowId: string,
    @Query('days') days?: string,
  ): Promise<ExecutionCost[]> {
    return this.costs.executions(instanceId, externalWorkflowId, clampDays(days, DEFAULT_EXECUTIONS_DAYS));
  }

  /** Poll immédiat de toutes les instances, sans attendre la cadence (bouton « Historiser »). */
  @Post('sample')
  sample(): Promise<LlmSampleResult> {
    return this.sampler.sampleDueInstances(true);
  }

  /**
   * Les tarifs vivent désormais dans le catalogue des modèles (`/model-catalog`),
   * hors module : éditer un tarif ne doit pas dépendre de l'activation d'ai-cost.
   * Ces routes restent le chemin de la page Coûts IA, qui n'a pas à savoir que
   * la table a déménagé.
   */
  @Get('prices')
  listPrices(): Promise<ModelCatalog[]> {
    return this.prices.list();
  }

  @Post('prices')
  createPrice(@Body() input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.prices.create(input);
  }

  @Put('prices/:id')
  updatePrice(@Param('id') id: string, @Body() input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.prices.update(id, input);
  }

  @Delete('prices/:id')
  async deletePrice(@Param('id') id: string): Promise<{ ok: true }> {
    await this.prices.remove(id);
    return { ok: true };
  }

  /** Valorise les appels restés sans coût avec la table actuelle (après ajout d'un tarif). */
  @Post('prices/apply-missing')
  applyMissing(): Promise<{ updated: number; stillUnknown: number }> {
    return this.costs.priceMissing();
  }
}

function clampDays(raw: string | undefined, fallback: number): number {
  const days = raw ? Number(raw) : fallback;
  if (!Number.isFinite(days) || days <= 0) return fallback;
  return Math.min(days, MAX_DAYS);
}
