import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EVENTS, PerfDriftDetectedEvent } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { PERFORMANCE_MANIFEST } from './manifest';
import { PerformanceService, WorkflowPerfSummary } from './performance.service';

/** Fenêtre comparée : 7 jours vs les 7 précédents, comme la vue par défaut de la page. */
const WINDOW_DAYS = 7;
/**
 * Hystérésis de sortie : l'alerte ne se réarme que sous ce ratio. Effacer dès
 * que ça repasse sous 2 ferait re-alerter à chaque oscillation autour du seuil.
 */
const CLEAR_BELOW_RATIO = 1.3;

export interface DriftCheckResult {
  drifting: number;
  newAlerts: number;
  cleared: number;
}

/**
 * Détection périodique des dérives de durée : réutilise le calcul de la page
 * Performance et n'alerte (événement `perf.driftDetected`, écouté par notifier)
 * qu'à l'ENTRÉE en dérive — l'état `PerfDriftAlert` mémorise ce qui a déjà été
 * signalé, la dérive étant recalculée à chaque contrôle.
 */
@Injectable()
export class DriftWatchService {
  private readonly logger = new Logger(DriftWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly performance: PerformanceService,
    private readonly eventBus: EventBusService,
    private readonly registry: ModuleRegistryService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(PERFORMANCE_MANIFEST.id))) return;
    try {
      await this.check();
    } catch (error) {
      this.logger.warn(`Drift check failed: ${(error as Error).message}`);
    }
  }

  async check(): Promise<DriftCheckResult> {
    const summary = await this.performance.summary(undefined, WINDOW_DAYS);
    const alerts = await this.prisma.perfDriftAlert.findMany();
    const alerted = new Map(alerts.map((a) => [`${a.instanceId}|${a.externalWorkflowId}`, a]));

    let newAlerts = 0;
    let cleared = 0;
    const drifting = summary.workflows.filter((w) => w.drifted);

    for (const workflow of drifting) {
      const key = `${workflow.instanceId}|${workflow.externalWorkflowId}`;
      if (alerted.has(key)) continue; // déjà signalée, on ne re-crie pas
      await this.prisma.perfDriftAlert.create({
        data: {
          instanceId: workflow.instanceId,
          externalWorkflowId: workflow.externalWorkflowId,
          ratio: workflow.driftRatio ?? 0,
        },
      });
      this.emit(workflow);
      newAlerts++;
    }

    // Réarmement : la médiane est redescendue (ou le workflow s'est tu).
    const stillDrifting = new Set(drifting.map((w) => `${w.instanceId}|${w.externalWorkflowId}`));
    const byKey = new Map(summary.workflows.map((w) => [`${w.instanceId}|${w.externalWorkflowId}`, w]));
    for (const [key, alert] of alerted) {
      if (stillDrifting.has(key)) continue;
      const current = byKey.get(key);
      if (current?.driftRatio != null && current.driftRatio >= CLEAR_BELOW_RATIO) continue;
      await this.prisma.perfDriftAlert.delete({ where: { id: alert.id } }).catch(() => undefined);
      cleared++;
    }

    if (newAlerts > 0 || cleared > 0) {
      this.logger.log(`Drifts: ${newAlerts} new, ${cleared} re-armed`);
    }
    return { drifting: drifting.length, newAlerts, cleared };
  }

  private emit(workflow: WorkflowPerfSummary): void {
    const event: PerfDriftDetectedEvent = {
      instanceId: workflow.instanceId,
      externalWorkflowId: workflow.externalWorkflowId,
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
      ratio: workflow.driftRatio ?? 0,
      p50Ms: workflow.p50Ms,
      days: WINDOW_DAYS,
      occurredAt: new Date().toISOString(),
    };
    this.eventBus.emit(EVENTS.perfDriftDetected, event);
  }
}
