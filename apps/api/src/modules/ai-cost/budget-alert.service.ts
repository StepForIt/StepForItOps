import { Injectable } from '@nestjs/common';
import { AiCostBudgetExceededEvent, EVENTS } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';

const SETTINGS_ID = 'default';
/** Contributeurs cités dans l'alerte : assez pour agir, pas de quoi noyer le message. */
const TOP_WORKFLOWS = 3;

export interface BudgetSettings {
  dailyBudgetUsd: number | null;
}

/**
 * Garde du budget quotidien : après chaque passe d'ingestion, compare le coût du
 * jour (UTC, même bucket que les courbes) au budget et émet `aiCost.budgetExceeded`
 * — une seule fois par jour, mémorisé en DB pour survivre aux redémarrages.
 * Le module n'alerte pas lui-même : `notifier` écoute, aucun import croisé.
 */
@Injectable()
export class BudgetAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async settings(): Promise<BudgetSettings> {
    const row = await this.prisma.aiCostSettings.findUnique({ where: { id: SETTINGS_ID } });
    return { dailyBudgetUsd: row?.dailyBudgetUsd ?? null };
  }

  async updateSettings(input: BudgetSettings): Promise<BudgetSettings> {
    const dailyBudgetUsd =
      typeof input.dailyBudgetUsd === 'number' && input.dailyBudgetUsd > 0 ? input.dailyBudgetUsd : null;
    await this.prisma.aiCostSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, dailyBudgetUsd },
      update: { dailyBudgetUsd },
    });
    return { dailyBudgetUsd };
  }

  /** À appeler après une passe d'ingestion ; silencieux sans budget configuré. */
  async checkToday(): Promise<void> {
    const settings = await this.prisma.aiCostSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!settings?.dailyBudgetUsd) return;

    const today = new Date().toISOString().slice(0, 10);
    if (settings.lastAlertedDate === today) return;

    const since = new Date(`${today}T00:00:00.000Z`);
    const rows = await this.prisma.llmUsage.findMany({
      where: { startedAt: { gte: since }, costUsd: { not: null } },
      select: { instanceId: true, externalWorkflowId: true, costUsd: true },
    });
    const costUsd = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    if (costUsd <= settings.dailyBudgetUsd) return;

    // Marqué AVANT l'émission : une erreur d'un canal ne doit pas re-déclencher demain matin.
    await this.prisma.aiCostSettings.update({
      where: { id: SETTINGS_ID },
      data: { lastAlertedDate: today },
    });

    const event: AiCostBudgetExceededEvent = {
      date: today,
      costUsd,
      budgetUsd: settings.dailyBudgetUsd,
      topWorkflows: await this.topWorkflows(rows),
      occurredAt: new Date().toISOString(),
    };
    this.eventBus.emit(EVENTS.aiCostBudgetExceeded, event);
  }

  private async topWorkflows(
    rows: Array<{ instanceId: string; externalWorkflowId: string; costUsd: number | null }>,
  ): Promise<Array<{ name: string; costUsd: number }>> {
    const byWorkflow = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.instanceId}|${row.externalWorkflowId}`;
      byWorkflow.set(key, (byWorkflow.get(key) ?? 0) + (row.costUsd ?? 0));
    }
    const top = [...byWorkflow.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_WORKFLOWS);
    const workflows = await this.prisma.workflow.findMany({
      where: {
        OR: top.map(([key]) => {
          const [instanceId, externalId] = key.split('|');
          return { instanceId, externalId };
        }),
      },
      select: { instanceId: true, externalId: true, name: true },
    });
    const names = new Map(workflows.map((w) => [`${w.instanceId}|${w.externalId}`, w.name]));
    return top.map(([key, cost]) => ({ name: names.get(key) ?? key, costUsd: cost }));
  }
}
