import { Injectable } from '@nestjs/common';
import { detectDrift, summarizeDurations } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface WorkflowPerfSummary {
  instanceId: string;
  externalWorkflowId: string;
  /** null si le workflow n'est pas (ou plus) synchronisé dans la plateforme. */
  workflowId: string | null;
  name: string;
  executions: number;
  errors: number;
  /** 0..1 — null sans exécution. */
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  /** médiane période récente / médiane période précédente — null faute de matière. */
  driftRatio: number | null;
  drifted: boolean;
  lastAt: string | null;
}

export interface PerfSummary {
  days: number;
  from: string;
  to: string;
  workflows: WorkflowPerfSummary[];
}

export interface PerfTrendBucket {
  date: string; // YYYY-MM-DD
  executions: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface PerfTrend {
  externalWorkflowId: string;
  days: number;
  buckets: PerfTrendBucket[];
}

/**
 * Synthèse des stats d'exécution par workflow. Percentiles calculés en mémoire
 * depuis les lignes maigres (volume borné) ; la dérive compare la fenêtre
 * demandée à la précédente de même taille (`execution-stats.ts`, conservateur).
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async summary(instanceId: string | undefined, days: number): Promise<PerfSummary> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const baselineFrom = new Date(from.getTime() - days * 24 * 3600 * 1000);

    const rows = await this.prisma.executionStat.findMany({
      where: {
        ...(instanceId ? { instanceId } : {}),
        startedAt: { gte: baselineFrom, lt: to },
      },
      select: {
        instanceId: true,
        externalWorkflowId: true,
        status: true,
        startedAt: true,
        durationMs: true,
      },
    });

    interface Acc {
      instanceId: string;
      executions: number;
      errors: number;
      recentDurations: number[];
      baselineDurations: number[];
      lastAt: Date | null;
    }
    const byWorkflow = new Map<string, Acc>();
    for (const row of rows) {
      const key = `${row.instanceId}|${row.externalWorkflowId}`;
      const acc =
        byWorkflow.get(key) ??
        ({
          instanceId: row.instanceId,
          executions: 0,
          errors: 0,
          recentDurations: [],
          baselineDurations: [],
          lastAt: null,
        } satisfies Acc);
      const recent = row.startedAt >= from;
      if (recent) {
        acc.executions++;
        if (row.status !== 'success') acc.errors++;
        if (row.durationMs !== null) acc.recentDurations.push(row.durationMs);
        if (!acc.lastAt || row.startedAt > acc.lastAt) acc.lastAt = row.startedAt;
      } else if (row.durationMs !== null) {
        acc.baselineDurations.push(row.durationMs);
      }
      byWorkflow.set(key, acc);
    }

    // Noms + exclusion des archivés, résolus depuis la DB plateforme
    // (l'API publique n8n ne renvoie pas le nom avec les exécutions).
    const workflows = await this.prisma.workflow.findMany({
      where: {
        ...(instanceId ? { instanceId } : {}),
        ...(await this.settings.workflowFilter()),
      },
      select: { id: true, instanceId: true, externalId: true, name: true },
    });
    const known = new Map(workflows.map((w) => [`${w.instanceId}|${w.externalId}`, w]));

    const result: WorkflowPerfSummary[] = [];
    for (const [key, acc] of byWorkflow) {
      if (acc.executions === 0) continue; // rien sur la fenêtre demandée
      const workflow = known.get(key);
      // Workflow inconnu de la plateforme = supprimé ou archivé : hors synthèse.
      if (!workflow) continue;
      const durations = summarizeDurations(acc.recentDurations);
      const drift = detectDrift(acc.baselineDurations, acc.recentDurations);
      result.push({
        instanceId: acc.instanceId,
        externalWorkflowId: workflow.externalId,
        workflowId: workflow.id,
        name: workflow.name,
        executions: acc.executions,
        errors: acc.errors,
        successRate: acc.executions > 0 ? (acc.executions - acc.errors) / acc.executions : null,
        p50Ms: durations.p50,
        p95Ms: durations.p95,
        driftRatio: drift.ratio,
        drifted: drift.drifted,
        lastAt: acc.lastAt?.toISOString() ?? null,
      });
    }
    result.sort((a, b) => b.executions - a.executions);

    return { days, from: from.toISOString(), to: to.toISOString(), workflows: result };
  }

  /** Tendance quotidienne d'un workflow : volume, échecs, médiane et P95 par jour. */
  async trend(instanceId: string, externalWorkflowId: string, days: number): Promise<PerfTrend> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const rows = await this.prisma.executionStat.findMany({
      where: { instanceId, externalWorkflowId, startedAt: { gte: from, lt: to } },
      select: { status: true, startedAt: true, durationMs: true },
      orderBy: { startedAt: 'asc' },
    });

    const byDay = new Map<string, { executions: number; errors: number; durations: number[] }>();
    for (const row of rows) {
      const date = row.startedAt.toISOString().slice(0, 10);
      const bucket = byDay.get(date) ?? { executions: 0, errors: 0, durations: [] };
      bucket.executions++;
      if (row.status !== 'success') bucket.errors++;
      if (row.durationMs !== null) bucket.durations.push(row.durationMs);
      byDay.set(date, bucket);
    }

    const buckets: PerfTrendBucket[] = [...byDay.entries()].map(([date, bucket]) => {
      const summary = summarizeDurations(bucket.durations);
      return {
        date,
        executions: bucket.executions,
        errors: bucket.errors,
        p50Ms: summary.p50,
        p95Ms: summary.p95,
      };
    });
    return { externalWorkflowId, days, buckets };
  }
}
