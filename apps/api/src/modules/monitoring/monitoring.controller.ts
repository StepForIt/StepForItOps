import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Monitor, Prisma } from '@prisma/client';
import { HeartbeatService } from './heartbeat.service';
import { ActiveCheckService } from './active-check.service';
import { ErrorWatchService } from './error-watch.service';
import { InstanceChecklist, MonitoringChecklistService } from './monitoring-checklist.service';
import {
  InstanceProvisionResult,
  KumaProvisioningService,
  ProbeIntervalSyncResult,
} from './kuma-provisioning.service';
import { ImportableProbe, KumaImportResult, KumaImportService } from './kuma-import.service';
import { KumaRedundancyService, RedundancyReview, RedundancyTagResult } from './kuma-redundancy.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';
import { PublicRoute } from '../../common/auth/public-route.decorator';

interface MonitorInput {
  name: string;
  kind: string;
  workflowId?: string;
  kumaPushUrl?: string;
  config?: object;
  enabled?: boolean;
}

@ModuleId('monitoring')
@Controller()
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  constructor(
    private readonly heartbeat: HeartbeatService,
    private readonly activeCheck: ActiveCheckService,
    private readonly errorWatch: ErrorWatchService,
    private readonly checklist: MonitoringChecklistService,
    private readonly provisioning: KumaProvisioningService,
    private readonly kumaImport: KumaImportService,
    private readonly kumaRedundancy: KumaRedundancyService,
    private readonly prisma: PrismaService,
  ) {}

  // --- Provisioning Uptime Kuma ---

  /** Le connecteur Kuma (Socket.io) est-il configuré (réglages DB ou variables d'env) ? */
  @Get('monitoring/kuma-status')
  kumaStatus(): Promise<{ configured: boolean }> {
    return this.provisioning.status();
  }

  /** Crée la sonde push Kuma pour un monitor existant. */
  @Post('monitors/:id/provision')
  provision(@Param('id') id: string): Promise<Monitor> {
    return this.provisioning.provisionMonitor(id);
  }

  /** Crée monitors heartbeat + sondes Kuma pour tous les workflows actifs d'une instance. */
  @Post('monitoring/provision-instance/:instanceId')
  provisionInstance(@Param('instanceId') instanceId: string): Promise<InstanceProvisionResult> {
    return this.provisioning.provisionInstance(instanceId);
  }

  /** Réaligne l'intervalle des sondes Kuma existantes sur la cadence de push de chaque monitor. */
  @Post('monitoring/kuma-sync-intervals')
  syncProbeIntervals(): Promise<ProbeIntervalSyncResult> {
    return this.provisioning.syncProbeIntervals();
  }

  /** Checklist de migration monitoring d'une instance (page Instances). */
  @Get('monitoring/instance-checklist/:instanceId')
  instanceChecklist(@Param('instanceId') instanceId: string): Promise<InstanceChecklist> {
    return this.checklist.forInstance(instanceId);
  }

  /** Monitors existants côté Uptime Kuma, avec leur état de rattachement local. */
  @Get('monitoring/kuma-probes')
  listKumaProbes(): Promise<ImportableProbe[]> {
    return this.kumaImport.listProbes();
  }

  /** Importe des sondes push Kuma pré-existantes en monitors locaux. */
  @Post('monitoring/kuma-import')
  importKumaProbes(@Body() body: { externalIds: number[] }): Promise<KumaImportResult> {
    return this.kumaImport.importProbes(body?.externalIds ?? []);
  }

  /** Sondes Kuma que la plateforme rend redondantes, pour revue avant marquage. */
  @Get('monitoring/kuma-redundant')
  reviewRedundant(): Promise<RedundancyReview> {
    return this.kumaRedundancy.review();
  }

  /** Pose l'étiquette « à désactiver » sur les sondes validées à la revue. */
  @Post('monitoring/kuma-tag-redundant')
  tagRedundant(@Body() body: { externalIds: number[] }): Promise<RedundancyTagResult> {
    return this.kumaRedundancy.tagCandidates(body?.externalIds ?? []);
  }

  // --- Heartbeat public (appelé par les workflows) ---

  // Appelé par les workflows n8n, pas par le front : hors jeton d'accès API.
  // Le `token` de l'URL est le secret propre au monitor.
  @PublicRoute()
  @Post('monitoring/beat/:token')
  beat(
    @Param('token') token: string,
    @Body() body?: { status?: 'up' | 'down'; message?: string },
  ): Promise<Monitor> {
    return this.heartbeat.beat(token, body?.status ?? 'up', body?.message);
  }

  // --- CRUD Monitors (resource Refine "monitors") ---

  @Get('monitors')
  async list(@Query() query: RefineListQuery, @Res({ passthrough: true }) res: Response): Promise<Monitor[]> {
    // Scope instance : monitors des workflows de l'instance + monitors « globaux » (sans workflow lié)
    const where: Prisma.MonitorWhereInput = query.instanceId
      ? { OR: [{ workflow: { instanceId: query.instanceId } }, { workflowId: null }] }
      : {};
    const { orderBy } = toPrismaListArgs(query, 'name', 'asc');
    const monitors = await this.prisma.monitor.findMany({
      where,
      orderBy,
      include: { workflow: { select: { name: true, instanceId: true } } },
    });
    return withTotalCount(res, monitors.length, monitors);
  }

  @Get('monitors/:id')
  get(@Param('id') id: string): Promise<Monitor | null> {
    return this.prisma.monitor.findUnique({ where: { id } });
  }

  @Post('monitors')
  create(@Body() body: MonitorInput): Promise<Monitor> {
    return this.prisma.monitor.create({ data: body });
  }

  @Patch('monitors/:id')
  async update(@Param('id') id: string, @Body() body: Partial<MonitorInput>): Promise<Monitor> {
    const monitor = await this.prisma.monitor.update({ where: { id }, data: body });
    // La config porte la cadence de push : la sonde Kuma doit suivre, sinon elle attend
    // des beats qui n'arriveront plus au même rythme. Best effort : Kuma peut être down.
    if (body.config !== undefined) {
      try {
        await this.provisioning.syncProbeIntervals(id);
      } catch (error) {
        this.logger.warn(
          `Kuma probe interval not realigned for ${monitor.name}: ${(error as Error).message}`,
        );
      }
    }
    return monitor;
  }

  /** Supprime le monitor local ET sa sonde Kuma si elle existe. */
  @Delete('monitors/:id')
  delete(@Param('id') id: string): Promise<Monitor> {
    return this.provisioning.deleteWithProbe(id);
  }

  /** Snippet HTTP Request à coller dans le workflow pour le heartbeat. */
  @Get('monitors/:id/snippet')
  async snippet(@Param('id') id: string): Promise<object> {
    const monitor = await this.prisma.monitor.findUniqueOrThrow({ where: { id } });
    const apiBaseUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
    return this.heartbeat.buildSnippet(monitor, apiBaseUrl);
  }

  /** Force un check immédiat (dispatch selon le kind du monitor). */
  @Post('monitors/:id/check')
  async checkNow(@Param('id') id: string): Promise<{ status: string }> {
    const monitor = await this.prisma.monitor.findUniqueOrThrow({ where: { id } });
    if (monitor.kind === 'error-watch') {
      return { status: await this.errorWatch.check(monitor) };
    }
    const status = await this.activeCheck.check(
      monitor.id,
      (monitor.config ?? {}) as { url?: string },
      monitor.kumaPushUrl,
    );
    return { status };
  }
}
