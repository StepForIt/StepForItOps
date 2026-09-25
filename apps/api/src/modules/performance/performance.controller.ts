import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { PERFORMANCE_MANIFEST } from './manifest';
import { PerfSummary, PerfTrend, PerformanceService } from './performance.service';
import { ExecutionStatSamplerService, SampleResult } from './execution-stat-sampler.service';
import { DriftCheckResult, DriftWatchService } from './drift-watch.service';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const DEFAULT_TREND_DAYS = 30;

@ModuleId(PERFORMANCE_MANIFEST.id)
@Controller('performance')
export class PerformanceController {
  constructor(
    private readonly performance: PerformanceService,
    private readonly sampler: ExecutionStatSamplerService,
    private readonly driftWatch: DriftWatchService,
  ) {}

  /** Contrôle de dérive immédiat, sans attendre le cron horaire. */
  @Post('drift-check')
  driftCheck(): Promise<DriftCheckResult> {
    return this.driftWatch.check();
  }

  /** Synthèse par workflow : volume, taux de succès, P50/P95 et dérive vs période précédente. */
  @Get('summary')
  summary(@Query('instanceId') instanceId?: string, @Query('days') days?: string): Promise<PerfSummary> {
    return this.performance.summary(instanceId, clampDays(days, DEFAULT_DAYS));
  }

  /** Tendance quotidienne d'un workflow (le graphe du détail). */
  @Get('trend/:instanceId/:externalWorkflowId')
  trend(
    @Param('instanceId') instanceId: string,
    @Param('externalWorkflowId') externalWorkflowId: string,
    @Query('days') days?: string,
  ): Promise<PerfTrend> {
    return this.performance.trend(instanceId, externalWorkflowId, clampDays(days, DEFAULT_TREND_DAYS));
  }

  /** Poll immédiat de toutes les instances, sans attendre la cadence (bouton « Rafraîchir »). */
  @Post('sample')
  sample(): Promise<SampleResult> {
    return this.sampler.sampleDueInstances(true);
  }
}

function clampDays(raw: string | undefined, fallback: number): number {
  const days = raw ? Number(raw) : fallback;
  if (!Number.isFinite(days) || days <= 0) return fallback;
  return Math.min(days, MAX_DAYS);
}
