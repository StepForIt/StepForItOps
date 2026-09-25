import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Garde-fou : au-delà, les agrégats restent justes en tendance mais tronqués. */
const MAX_ROWS = 20000;
/** Fuseau utilisé pour découper les journées (sinon une erreur de 00h30 tombe la veille). */
const TIME_ZONE = process.env.TZ || 'Europe/Paris';

export interface ErrorStatsBucket {
  /** YYYY-MM-DD */
  date: string;
  total: number;
  /** Clé = externalWorkflowId */
  byWorkflow: Record<string, number>;
}

export interface ErrorStatsWorkflow {
  externalWorkflowId: string;
  workflowId: string | null;
  name: string;
  total: number;
  lastAt: string;
}

export interface ErrorStats {
  days: number;
  from: string;
  to: string;
  total: number;
  truncated: boolean;
  /** Erreurs dont le détail (nœud fautif, message) n'a pas encore été récupéré. */
  pendingDetails: number;
  /** Problèmes distincts non traités dont la dernière occurrence tombe dans la période. */
  openGroups: number;
  /** Erreurs pas encore rattachées à un groupe (historique importé avant la fonctionnalité). */
  ungrouped: number;
  /** Un bucket par jour, du plus ancien au plus récent, jours vides inclus. */
  buckets: ErrorStatsBucket[];
  /** Workflows concernés, du plus cassant au moins cassant. */
  workflows: ErrorStatsWorkflow[];
}

/** Agrégats de l'historique d'erreurs pour les visualisations (courbe + heatmap). */
@Injectable()
export class ErrorStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(options: { instanceId?: string; workflowId?: string; days?: number }): Promise<ErrorStats> {
    const days = clamp(options.days ?? 30, 1, 365);
    const from = startOfDay(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000));

    const where: Prisma.ExecutionErrorWhereInput = {
      startedAt: { gte: from },
      ...(options.instanceId ? { instanceId: options.instanceId } : {}),
      ...(options.workflowId ? { workflowId: options.workflowId } : {}),
    };
    const [rows, pendingDetails, openGroups, ungrouped] = await Promise.all([
      this.prisma.executionError.findMany({
        where,
        select: { startedAt: true, externalWorkflowId: true, workflowId: true, workflowName: true },
        orderBy: { startedAt: 'asc' },
        take: MAX_ROWS,
      }),
      this.prisma.executionError.count({ where: { ...where, detailState: 'pending' } }),
      this.prisma.errorGroup.count({
        where: {
          status: 'open',
          lastSeenAt: { gte: from },
          ...(options.instanceId ? { instanceId: options.instanceId } : {}),
          ...(options.workflowId ? { workflowId: options.workflowId } : {}),
        },
      }),
      this.prisma.executionError.count({ where: { ...where, groupId: null } }),
    ]);

    const buckets = emptyBuckets(from, days);
    const byDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));
    const workflows = new Map<string, ErrorStatsWorkflow>();

    for (const row of rows) {
      const bucket = byDate.get(dayKey(row.startedAt));
      if (bucket) {
        bucket.total += 1;
        bucket.byWorkflow[row.externalWorkflowId] = (bucket.byWorkflow[row.externalWorkflowId] ?? 0) + 1;
      }
      const known = workflows.get(row.externalWorkflowId);
      if (known) {
        known.total += 1;
        known.lastAt = row.startedAt.toISOString();
        known.name = row.workflowName;
      } else {
        workflows.set(row.externalWorkflowId, {
          externalWorkflowId: row.externalWorkflowId,
          workflowId: row.workflowId,
          name: row.workflowName,
          total: 1,
          lastAt: row.startedAt.toISOString(),
        });
      }
    }

    return {
      days,
      from: dayKey(from),
      to: dayKey(new Date()),
      total: rows.length,
      truncated: rows.length === MAX_ROWS,
      pendingDetails,
      openGroups,
      ungrouped,
      buckets,
      workflows: [...workflows.values()].sort((a, b) => b.total - a.total),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** YYYY-MM-DD dans le fuseau d'affichage (le format « sv-SE » est déjà ISO). */
function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(date);
}

function emptyBuckets(from: Date, days: number): ErrorStatsBucket[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dayKey(new Date(from.getTime() + index * 24 * 3600 * 1000)),
    total: 0,
    byWorkflow: {},
  }));
}
