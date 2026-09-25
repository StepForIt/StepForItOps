import { Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExecutionError, Prisma } from '@prisma/client';
import { BackfillResult, ErrorHistoryService } from './error-history.service';
import { ErrorStats, ErrorStatsService } from './error-stats.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

/** Ligne d'historique enrichie du lien direct vers l'exécution dans n8n. */
export type ExecutionErrorView = ExecutionError & { n8nUrl: string | null };

/** Historique des exécutions n8n en erreur (resource Refine « execution-errors »). */
@ModuleId('monitoring')
@Controller('execution-errors')
export class ErrorHistoryController {
  constructor(
    private readonly history: ErrorHistoryService,
    private readonly stats: ErrorStatsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Agrégats pour les graphes — déclaré avant `:id` pour ne pas être capté par la route param. */
  @Get('stats')
  getStats(
    @Query('instanceId') instanceId?: string,
    @Query('workflowId') workflowId?: string,
    @Query('days') days?: string,
  ): Promise<ErrorStats> {
    return this.stats.stats({ instanceId, workflowId, days: days ? Number(days) : undefined });
  }

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExecutionErrorView[]> {
    const where = buildWhere(query);
    const { skip, take, orderBy } = toPrismaListArgs(query, 'startedAt', 'desc');
    const [rows, total] = await Promise.all([
      this.prisma.executionError.findMany({ where, orderBy, skip, take }),
      this.prisma.executionError.count({ where }),
    ]);
    return withTotalCount(res, total, await this.withN8nUrls(rows));
  }

  /** Détail « quel nœud a fail » : récupéré depuis n8n au premier appel, puis servi du cache. */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ExecutionErrorView> {
    const [row] = await this.withN8nUrls([await this.history.detail(id)]);
    return row;
  }

  /**
   * Ajoute le lien vers l'exécution dans n8n. Résolu ici pour n'exposer que la baseUrl
   * (la clé API de l'instance ne doit pas transiter vers l'UI).
   */
  private async withN8nUrls(rows: ExecutionError[]): Promise<ExecutionErrorView[]> {
    const instanceIds = [...new Set(rows.map((row) => row.instanceId))];
    const instances = await this.prisma.instance.findMany({
      where: { id: { in: instanceIds } },
      select: { id: true, baseUrl: true },
    });
    const baseUrls = new Map(instances.map((instance) => [instance.id, instance.baseUrl]));
    return rows.map((row) => {
      const baseUrl = baseUrls.get(row.instanceId)?.replace(/\/$/, '');
      return {
        ...row,
        n8nUrl: baseUrl
          ? `${baseUrl}/workflow/${row.externalWorkflowId}/executions/${row.executionId}`
          : null,
      };
    });
  }

  /** Importe l'historique d'erreurs déjà présent dans n8n pour une instance. */
  @Post('backfill/:instanceId')
  backfill(@Param('instanceId') instanceId: string, @Query('days') days?: string): Promise<BackfillResult> {
    return this.history.backfill(instanceId, days ? Number(days) : undefined);
  }
}

function buildWhere(query: RefineListQuery): Prisma.ExecutionErrorWhereInput {
  const where: Prisma.ExecutionErrorWhereInput = {};
  if (query.instanceId) where.instanceId = query.instanceId;
  if (query.workflowId) where.workflowId = query.workflowId;
  if (query.externalWorkflowId) where.externalWorkflowId = query.externalWorkflowId;
  // Fenêtre temporelle : soit une profondeur en jours, soit un intervalle explicite
  // (clic sur une barre / une case du graphe).
  const range: Prisma.DateTimeFilter = {};
  if (query.days) {
    const days = Number(query.days);
    if (Number.isFinite(days) && days > 0) range.gte = new Date(Date.now() - days * 24 * 3600 * 1000);
  }
  if (query.from) range.gte = new Date(query.from);
  if (query.to) range.lt = new Date(query.to);
  if (range.gte || range.lt) where.startedAt = range;
  if (query.q) {
    where.OR = [
      { workflowName: { contains: query.q, mode: 'insensitive' } },
      { message: { contains: query.q, mode: 'insensitive' } },
      { failedNode: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  return where;
}
