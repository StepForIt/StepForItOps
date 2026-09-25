import { Injectable } from '@nestjs/common';
import { LlmNodeUsage } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Fenêtre d'observation : la même que celle des classements de la page Coûts IA. */
export const USAGE_WINDOW_DAYS = 30;

interface UsageRow {
  nodeName: string;
  calls: bigint;
  promptTokens: bigint;
  completionTokens: bigint;
  costUsd: number | null;
  p95: number | null;
}

/**
 * Ce que les exécutions ont MESURÉ, par nœud.
 *
 * Lit directement `LlmUsage` — la table d'`ai-cost` — sans passer par ses
 * services : c'est le précédent `dashboard`, et c'est ce qui permet à l'audit de
 * continuer quand `ai-cost` est coupé. Rien n'est estimé ici : sans mesure, les
 * règles qui en dépendent se taisent.
 *
 * Le p95 est calculé par Postgres (`percentile_cont`) plutôt qu'en mémoire :
 * un mois d'appels d'un parc, c'est des dizaines de milliers de lignes qu'on
 * n'a aucune raison de rapatrier pour en tirer un seul nombre.
 */
@Injectable()
export class NodeUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async byNode(
    instanceId: string,
    externalWorkflowId: string,
    days = USAGE_WINDOW_DAYS,
  ): Promise<Record<string, LlmNodeUsage>> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<UsageRow[]>`
      SELECT "nodeName",
             COUNT(*) AS calls,
             SUM("promptTokens") AS "promptTokens",
             SUM("completionTokens") AS "completionTokens",
             SUM("costUsd") AS "costUsd",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "promptTokens") AS p95
      FROM "LlmUsage"
      WHERE "instanceId" = ${instanceId}
        AND "externalWorkflowId" = ${externalWorkflowId}
        AND "startedAt" >= ${since}
      GROUP BY "nodeName"
    `;
    return Object.fromEntries(
      rows.map((row) => [
        row.nodeName,
        {
          calls: Number(row.calls),
          promptTokens: Number(row.promptTokens),
          completionTokens: Number(row.completionTokens),
          promptTokensP95: row.p95 ?? 0,
          days,
        } satisfies LlmNodeUsage,
      ]),
    );
  }

  /** Le coût mesuré par modèle sur la fenêtre, pour la vue de parc. */
  async byModel(days = USAGE_WINDOW_DAYS): Promise<Map<string, { costUsd: number; calls: number }>> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.llmUsage.groupBy({
      by: ['model'],
      where: { startedAt: { gte: since }, model: { not: null } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    return new Map(
      rows.map((row) => [
        (row.model ?? '').toLowerCase(),
        { costUsd: row._sum.costUsd ?? 0, calls: row._count._all },
      ]),
    );
  }
}
