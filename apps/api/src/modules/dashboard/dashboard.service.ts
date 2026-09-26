import { Injectable } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

/** Fenêtre plancher : même vu il y a 5 minutes, on montre au moins les dernières 24 h. */
const MIN_WINDOW_HOURS = 24;
/** Fenêtre plafond : après un mois d'absence, « depuis ta visite » n'aide plus personne. */
const MAX_WINDOW_DAYS = 30;

export interface DashboardOverview {
  /** Début de la fenêtre affichée. */
  since: string;
  /** Dernière visite réelle de CET utilisateur — null au premier passage. */
  lastVisitAt: string | null;
  executions: { total: number; errors: number; successRate: number | null };
  problems: { opened: number; regressed: number; openTotal: number };
  drifts: Array<{ workflowName: string; ratio: number; alertedAt: string }>;
  coverage: { workflows: number; neverAnalyzed: number };
  llm: { costUsd: number | null; calls: number };
  timeSavedMinutes: number;
  /** Part de ce total qui vient d'une ESTIMATION et non d'un chiffre saisi : dite
   * à l'écran, sinon une estimation passe pour une mesure. */
  timeSavedEstimatedMinutes: number;
  clients: Array<{
    clientId: string | null;
    clientName: string;
    instances: number;
    executions: number;
    errors: number;
    successRate: number | null;
    timeSavedMinutes: number;
    llmCostUsd: number | null;
  }>;
}

/**
 * La vue du matin, calculée sur « depuis ta dernière visite » (par utilisateur,
 * bornée entre 24 h et 30 j) : tout est relu depuis les tables des autres
 * modules — lectures directes, jamais leurs services.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async overview(userEmail: string | undefined): Promise<DashboardOverview> {
    const email = userEmail?.trim() || '(anonyme)';
    const now = new Date();
    const visit = await this.prisma.dashboardVisit.findUnique({ where: { userEmail: email } });
    const floor = new Date(now.getTime() - MIN_WINDOW_HOURS * 3600 * 1000);
    const ceiling = new Date(now.getTime() - MAX_WINDOW_DAYS * 24 * 3600 * 1000);
    const since = new Date(
      Math.max(ceiling.getTime(), Math.min(floor.getTime(), visit?.lastSeenAt.getTime() ?? floor.getTime())),
    );
    // La visite est estampillée après lecture : c'est la PROCHAINE fenêtre qu'elle borne.
    await this.prisma.dashboardVisit.upsert({
      where: { userEmail: email },
      create: { userEmail: email },
      update: { lastSeenAt: now },
    });

    const [instances, stats, opened, regressed, openTotal, driftRows, workflows, llmAgg] = await Promise.all([
      this.prisma.instance.findMany({ include: { client: true } }),
      this.prisma.executionStat.findMany({
        where: { startedAt: { gte: since } },
        select: { instanceId: true, externalWorkflowId: true, status: true },
      }),
      this.prisma.errorGroup.count({ where: { createdAt: { gte: since } } }),
      this.prisma.errorGroupEvent.count({
        where: { type: 'regression', createdAt: { gte: since } },
      }),
      this.prisma.errorGroup.count({ where: { status: 'open' } }),
      this.prisma.perfDriftAlert.findMany(),
      this.prisma.workflow.findMany({
        where: await this.settings.workflowFilter(),
        select: {
          instanceId: true,
          externalId: true,
          name: true,
          minutesSavedPerExecution: true,
          minutesSavedEstimate: true,
          _count: { select: { analysisRuns: true } },
        },
      }),
      this.prisma.llmUsage
        .groupBy({
          by: ['instanceId'],
          where: { startedAt: { gte: since } },
          _sum: { costUsd: true },
          _count: { _all: true },
        })
        .catch(() => []),
    ]);

    // Volume, succès et temps gagné, par instance (le temps gagné ne compte que les
    // succès). Le chiffre SAISI prime toujours sur l'estimation : c'est le seul des
    // deux que quelqu'un ait mesuré.
    const savedByWorkflow = new Map(
      workflows.map((w) => [
        `${w.instanceId}|${w.externalId}`,
        {
          minutes: w.minutesSavedPerExecution ?? w.minutesSavedEstimate ?? 0,
          estimated: w.minutesSavedPerExecution == null,
        },
      ]),
    );
    const perInstance = new Map<
      string,
      { executions: number; errors: number; saved: number; savedEstimated: number }
    >();
    for (const row of stats) {
      const acc = perInstance.get(row.instanceId) ?? {
        executions: 0,
        errors: 0,
        saved: 0,
        savedEstimated: 0,
      };
      acc.executions++;
      if (row.status !== 'success') acc.errors++;
      else {
        const saved = savedByWorkflow.get(`${row.instanceId}|${row.externalWorkflowId}`);
        acc.saved += saved?.minutes ?? 0;
        if (saved?.estimated) acc.savedEstimated += saved.minutes;
      }
      perInstance.set(row.instanceId, acc);
    }

    const driftNames = new Map(workflows.map((w) => [`${w.instanceId}|${w.externalId}`, w.name]));
    const llmByInstance = new Map(
      llmAgg.map((row) => [row.instanceId, { cost: row._sum.costUsd, calls: row._count._all }]),
    );

    // Rollup par client — les instances sans client forment la ligne « Sans client ».
    const clients = new Map<string, DashboardOverview['clients'][number]>();
    for (const instance of instances) {
      const key = instance.clientId ?? '(none)';
      const entry =
        clients.get(key) ??
        ({
          clientId: instance.clientId,
          clientName: instance.client?.name ?? msg('ops.noClient'),
          instances: 0,
          executions: 0,
          errors: 0,
          successRate: null,
          timeSavedMinutes: 0,
          llmCostUsd: null,
        } satisfies DashboardOverview['clients'][number]);
      entry.instances++;
      const acc = perInstance.get(instance.id);
      if (acc) {
        entry.executions += acc.executions;
        entry.errors += acc.errors;
        entry.timeSavedMinutes += acc.saved;
      }
      const llm = llmByInstance.get(instance.id);
      if (llm?.cost != null) entry.llmCostUsd = (entry.llmCostUsd ?? 0) + llm.cost;
      clients.set(key, entry);
    }
    for (const entry of clients.values()) {
      entry.successRate = entry.executions > 0 ? (entry.executions - entry.errors) / entry.executions : null;
    }

    const total = stats.length;
    const errors = stats.filter((row) => row.status !== 'success').length;
    const llmCost = llmAgg.reduce<number | null>(
      (sum, row) => (row._sum.costUsd != null ? (sum ?? 0) + row._sum.costUsd : sum),
      null,
    );

    return {
      since: since.toISOString(),
      lastVisitAt: visit?.lastSeenAt.toISOString() ?? null,
      executions: {
        total,
        errors,
        successRate: total > 0 ? (total - errors) / total : null,
      },
      problems: { opened, regressed, openTotal },
      drifts: driftRows.map((row) => ({
        workflowName: driftNames.get(`${row.instanceId}|${row.externalWorkflowId}`) ?? row.externalWorkflowId,
        ratio: row.ratio,
        alertedAt: row.alertedAt.toISOString(),
      })),
      coverage: {
        workflows: workflows.length,
        neverAnalyzed: workflows.filter((w) => w._count.analysisRuns === 0).length,
      },
      llm: {
        costUsd: llmCost,
        calls: llmAgg.reduce((sum, row) => sum + row._count._all, 0),
      },
      timeSavedMinutes: [...perInstance.values()].reduce((sum, acc) => sum + acc.saved, 0),
      timeSavedEstimatedMinutes: [...perInstance.values()].reduce((sum, acc) => sum + acc.savedEstimated, 0),
      clients: [...clients.values()].sort((a, b) => b.executions - a.executions),
    };
  }
}
