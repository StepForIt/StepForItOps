import { Controller, Delete, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Finding, Prisma } from '@prisma/client';
import { EnvName, detectWorkflowEnv, n8nWorkflowUrl } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

export interface WorkflowAnalysisSummary {
  workflowId: string;
  instanceId: string;
  name: string;
  env: EnvName | null;
  active: boolean;
  n8nUrl: string;
  counts: { error: number; warning: number; info: number };
  byModule: Record<string, number>;
  lastCheckAt: string | null;
}

/** Resource transverse "findings" (produite par verifier / js-checker / optimizer). */
@Controller('findings')
export class FindingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Couverture d'analyse : tous les workflows (hors archivés, cf. réglages),
   * avec ou sans findings. C'est aussi cette liste qui pilote « Tout vérifier » :
   * un workflow absent d'ici n'est jamais analysé.
   */
  @Get('summary')
  async summary(@Query('instanceId') instanceId?: string): Promise<WorkflowAnalysisSummary[]> {
    const archivedFilter = await this.settings.workflowFilter();
    const envs = await this.settings.declaredEnvIds();
    const [workflows, bySeverity, latestRuns] = await Promise.all([
      this.prisma.workflow.findMany({
        where: { ...(instanceId ? { instanceId } : {}), ...archivedFilter },
        orderBy: { name: 'asc' },
        include: { instance: { select: { baseUrl: true } } },
      }),
      this.prisma.finding.groupBy({ by: ['workflowId', 'severity'], _count: { _all: true } }),
      // Dernier run par (workflow, module) — une analyse "propre" (0 finding) reste visible
      this.prisma.analysisRun.findMany({
        distinct: ['workflowId', 'module'],
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return workflows.map((workflow) => {
      const counts = { error: 0, warning: 0, info: 0 };
      for (const row of bySeverity.filter((r) => r.workflowId === workflow.id)) {
        counts[row.severity as keyof typeof counts] = row._count._all;
      }
      const runs = latestRuns.filter((r) => r.workflowId === workflow.id);
      const modules: Record<string, number> = {};
      for (const run of runs) modules[run.module] = run.findingsCount;
      const lastRun = runs.reduce<Date | null>(
        (max, run) => (max && max > run.createdAt ? max : run.createdAt),
        null,
      );
      return {
        workflowId: workflow.id,
        instanceId: workflow.instanceId,
        name: workflow.name,
        env: detectWorkflowEnv(workflow.name, workflow.tags, envs),
        active: workflow.active,
        n8nUrl: n8nWorkflowUrl(workflow.instance.baseUrl, workflow.externalId),
        counts,
        byModule: modules,
        lastCheckAt: lastRun?.toISOString() ?? null,
      };
    });
  }

  @Get()
  async list(@Query() query: RefineListQuery, @Res({ passthrough: true }) res: Response): Promise<Finding[]> {
    const where: Prisma.FindingWhereInput = {
      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      ...(query.module ? { module: query.module } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      // Findings résiduels d'un workflow archivé : masqués comme le workflow lui-même
      workflow: {
        ...(query.instanceId ? { instanceId: query.instanceId } : {}),
        ...(await this.settings.workflowFilter()),
      },
    };
    const args = toPrismaListArgs(query);
    const [data, total] = await Promise.all([
      this.prisma.finding.findMany({ where, ...args, include: { workflow: { select: { name: true } } } }),
      this.prisma.finding.count({ where }),
    ]);
    return withTotalCount(res, total, data);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Finding | null> {
    return this.prisma.finding.findUnique({ where: { id } });
  }

  @Delete(':id')
  delete(@Param('id') id: string): Promise<Finding> {
    return this.prisma.finding.delete({ where: { id } });
  }
}
