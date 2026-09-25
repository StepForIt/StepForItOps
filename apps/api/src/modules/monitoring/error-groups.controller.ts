import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ErrorGroup, ErrorGroupEvent, Prisma } from '@prisma/client';
import { ErrorGroupService, RegroupResult } from './error-group.service';
import { ExecutionErrorView } from './error-history.controller';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

/** Dernières occurrences remontées avec le détail d'un groupe. */
const RECENT_OCCURRENCES = 20;

export interface ErrorGroupDetail extends ErrorGroup {
  events: ErrorGroupEvent[];
  recent: ExecutionErrorView[];
}

export interface GroupActionBody {
  note?: string;
}

/**
 * Groupes d'erreurs (resource Refine « error-groups ») : la même erreur vue N fois
 * n'est qu'une ligne, qu'on peut marquer traitée. L'historique de chaque groupe
 * (traitée / rouverte / rechute) est renvoyé avec son détail.
 */
@ModuleId('monitoring')
@Controller('error-groups')
export class ErrorGroupsController {
  constructor(
    private readonly groups: ErrorGroupService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ErrorGroup[]> {
    const where = buildWhere(query);
    const { skip, take, orderBy } = toPrismaListArgs(query, 'lastSeenAt', 'desc');
    const [rows, total] = await Promise.all([
      this.prisma.errorGroup.findMany({ where, orderBy, skip, take }),
      this.prisma.errorGroup.count({ where }),
    ]);
    return withTotalCount(res, total, rows);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ErrorGroupDetail> {
    const group = await this.prisma.errorGroup.findUniqueOrThrow({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'desc' } },
        errors: { orderBy: { startedAt: 'desc' }, take: RECENT_OCCURRENCES },
      },
    });
    const instance = await this.prisma.instance.findUnique({
      where: { id: group.instanceId },
      select: { baseUrl: true },
    });
    const baseUrl = instance?.baseUrl.replace(/\/$/, '');
    const { errors, ...rest } = group;
    return {
      ...rest,
      recent: errors.map((row) => ({
        ...row,
        n8nUrl: baseUrl
          ? `${baseUrl}/workflow/${row.externalWorkflowId}/executions/${row.executionId}`
          : null,
      })),
    };
  }

  /** « C'est traité ». Si l'erreur revient, le groupe se rouvrira tout seul. */
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() body: GroupActionBody,
    @Headers('x-user-email') author?: string,
  ): Promise<ErrorGroup> {
    return this.groups.resolve(id, { note: body?.note, author });
  }

  @Post(':id/reopen')
  reopen(
    @Param('id') id: string,
    @Body() body: GroupActionBody,
    @Headers('x-user-email') author?: string,
  ): Promise<ErrorGroup> {
    return this.groups.reopen(id, { note: body?.note, author });
  }

  /** Erreur connue et acceptée : elle ne remonte plus, même si elle se répète. */
  @Post(':id/ignore')
  ignore(
    @Param('id') id: string,
    @Body() body: GroupActionBody,
    @Headers('x-user-email') author?: string,
  ): Promise<ErrorGroup> {
    return this.groups.ignore(id, { note: body?.note, author });
  }

  @Post(':id/note')
  comment(
    @Param('id') id: string,
    @Body() body: GroupActionBody,
    @Headers('x-user-email') author?: string,
  ): Promise<ErrorGroup> {
    return this.groups.comment(id, { note: body?.note, author });
  }

  /** Recatégorise les groupes existants (historique d'avant la catégorie). */
  @Post('recategorize')
  recategorize(@Query('instanceId') instanceId?: string): Promise<{ processed: number; changed: number }> {
    return this.groups.recategorize(instanceId);
  }

  /** Range les erreurs pas encore groupées (historique importé avant la fonctionnalité). */
  @Post('regroup')
  regroup(@Query('instanceId') instanceId?: string, @Query('limit') limit?: string): Promise<RegroupResult> {
    return this.groups.regroup(instanceId, limit ? Number(limit) : undefined);
  }
}

function buildWhere(query: RefineListQuery): Prisma.ErrorGroupWhereInput {
  const where: Prisma.ErrorGroupWhereInput = {};
  if (query.instanceId) where.instanceId = query.instanceId;
  if (query.workflowId) where.workflowId = query.workflowId;
  if (query.externalWorkflowId) where.externalWorkflowId = query.externalWorkflowId;
  if (query.status) where.status = query.status;
  if (query.category) where.category = query.category;
  // Fenêtre : un groupe est « de la période » si sa dernière occurrence y tombe.
  if (query.days) {
    const days = Number(query.days);
    if (Number.isFinite(days) && days > 0) {
      where.lastSeenAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
    }
  }
  // Jour précis cliqué dans un graphe : le groupe s'étale sur plusieurs jours, on
  // le garde si AU MOINS une de ses occurrences tombe dans l'intervalle.
  if (query.from || query.to) {
    where.errors = {
      some: {
        startedAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lt: new Date(query.to) } : {}),
        },
      },
    };
  }
  if (query.q) {
    where.OR = [
      { workflowName: { contains: query.q, mode: 'insensitive' } },
      { pattern: { contains: query.q, mode: 'insensitive' } },
      { failedNode: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  return where;
}
