import { Injectable } from '@nestjs/common';
import {
  buildAutoWorkflowLinks,
  detectWorkflowEnv,
  EnvDefinition,
  extractResourceRefs,
  extractUrlHost,
  findEnv,
  isMonitoredEnv,
  makeScenarioUrl,
  N8nWorkflow,
  n8nWorkflowUrl,
  workflowEntryPoints,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { TESTER_WORKFLOW_WHERE } from '../../infra/settings/tester-workflows.where';

const DAY_MS = 24 * 60 * 60 * 1000;
export const IMPACT_WINDOW_DAYS = 30;

export interface ContextWorkflow {
  id: string;
  name: string;
  instanceId: string;
  instanceName: string;
  externalId: string;
  active: boolean;
  env: string | null;
  platform: 'n8n' | 'make';
  url: string;
  raw: unknown;
  archived: boolean;
}

export interface ExecutionCounts {
  total: number;
  failed: number;
  lastAt: Date | null;
}

/**
 * Tout ce qu'une étude d'impact lit, chargé UNE fois pour un lot : la liste des
 * workflows (pour résoudre qui appelle qui, sur tout le parc), les liens, les
 * exécutions des 30 derniers jours, sondes, problèmes ouverts, tests, verrous et
 * mappings. Lectures directes des tables des autres modules, jamais leurs services
 * (précédent `dashboard`) : l'étude reste disponible quand l'un d'eux est coupé —
 * elle dit alors zéro sur ce qu'il aurait historisé.
 */
@Injectable()
export class ImpactContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async load() {
    const since = new Date(Date.now() - IMPACT_WINDOW_DAYS * DAY_MS);
    const envs: EnvDefinition[] = await this.settings.declaredEnvs();
    const envIds = envs.map((env) => env.id);
    const [rows, instances, manualLinks, stats, monitors, errors, tests, locks, mappings] = await Promise.all(
      [
        this.prisma.workflow.findMany({
          where: { missingUpstreamAt: null, NOT: TESTER_WORKFLOW_WHERE },
          select: {
            id: true,
            name: true,
            instanceId: true,
            externalId: true,
            active: true,
            tags: true,
            raw: true,
            archivedUpstream: true,
          },
        }),
        this.prisma.instance.findMany({
          select: { id: true, name: true, baseUrl: true, platform: true, zone: true, externalTeamId: true },
        }),
        this.prisma.workflowLink.findMany({ select: { fromWorkflowId: true, toWorkflowId: true } }),
        this.prisma.executionStat.groupBy({
          by: ['instanceId', 'externalWorkflowId', 'status'],
          where: { startedAt: { gte: since } },
          _count: { _all: true },
          _max: { startedAt: true },
        }),
        this.prisma.monitor.groupBy({ by: ['workflowId'], where: { enabled: true }, _count: { _all: true } }),
        this.prisma.errorGroup.groupBy({
          by: ['workflowId'],
          where: { status: 'open' },
          _count: { _all: true },
        }),
        this.prisma.testCase.findMany({
          where: { enabled: true },
          select: { workflowId: true, lastStatus: true },
        }),
        this.prisma.workflowLock.findMany({ select: { workflowId: true } }),
        this.prisma.resourceMapping.findMany({ select: { values: true } }),
      ],
    );

    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const workflows: ContextWorkflow[] = rows.map((row) => {
      const instance = instanceById.get(row.instanceId);
      const platform = instance?.platform === 'make' ? 'make' : 'n8n';
      return {
        id: row.id,
        name: row.name,
        instanceId: row.instanceId,
        instanceName: instance?.name ?? '',
        externalId: row.externalId,
        active: row.active,
        env: detectWorkflowEnv(row.name, row.tags, envIds),
        platform,
        url:
          platform === 'make'
            ? makeScenarioUrl(instance?.zone ?? null, instance?.externalTeamId ?? null, row.externalId)
            : n8nWorkflowUrl(instance?.baseUrl ?? '', row.externalId),
        raw: row.raw,
        archived: row.archivedUpstream,
      };
    });
    const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));

    // Appels détectés sur tout le parc n8n + liens posés à la main : qui casse avec qui.
    const n8n = workflows.filter((workflow) => workflow.platform === 'n8n');
    const knownHosts = instances
      .map((instance) => extractUrlHost(instance.baseUrl))
      .filter((host): host is string => !!host);
    const callersOf = new Map<string, Set<string>>();
    const calleesOf = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      if (from === to) return;
      if (!callersOf.has(to)) callersOf.set(to, new Set());
      if (!calleesOf.has(from)) calleesOf.set(from, new Set());
      callersOf.get(to)!.add(from);
      calleesOf.get(from)!.add(to);
    };
    for (const auto of buildAutoWorkflowLinks(
      n8n.map((w) => ({ id: w.id, externalId: w.externalId, name: w.name, raw: w.raw as N8nWorkflow })),
      knownHosts,
    )) {
      if (auto.toWorkflowId) link(auto.fromWorkflowId, auto.toWorkflowId);
    }
    for (const manual of manualLinks) link(manual.fromWorkflowId, manual.toWorkflowId);

    const executions = new Map<string, ExecutionCounts>();
    for (const stat of stats) {
      const key = `${stat.instanceId}/${stat.externalWorkflowId}`;
      const current = executions.get(key) ?? { total: 0, failed: 0, lastAt: null };
      current.total += stat._count._all;
      if (stat.status !== 'success') current.failed += stat._count._all;
      const last = stat._max.startedAt;
      if (last && (!current.lastAt || last > current.lastAt)) current.lastAt = last;
      executions.set(key, current);
    }

    const count = (groups: Array<{ workflowId: string | null; _count: { _all: number } }>) =>
      new Map(groups.filter((g) => g.workflowId).map((g) => [g.workflowId as string, g._count._all]));
    const testsOf = new Map<string, { total: number; red: number }>();
    for (const test of tests) {
      const current = testsOf.get(test.workflowId) ?? { total: 0, red: 0 };
      current.total += 1;
      if (test.lastStatus === 'failed' || test.lastStatus === 'error') current.red += 1;
      testsOf.set(test.workflowId, current);
    }

    // Une ressource est « mappée » si un de ses identifiants figure dans un mapping d'env.
    const mapped = new Set<string>();
    const collect = (value: unknown) => {
      if (typeof value === 'string') mapped.add(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    mappings.forEach((mapping) => collect(mapping.values));

    return {
      envs,
      byId,
      workflows,
      callersOf,
      calleesOf,
      executions,
      monitors: count(monitors),
      openErrors: count(errors),
      testsOf,
      locked: new Set(locks.map((lock) => lock.workflowId)),
      isMapped: (key: string) =>
        key
          .slice(key.indexOf(':') + 1)
          .split('/')
          .some((id) => mapped.has(id)),
      monitored: (env: string | null) => isMonitoredEnv(env, envs),
      envLabel: (env: string | null) => (env ? findEnv(envs, env)?.label || env.toUpperCase() : null),
      entryPoints: (workflow: ContextWorkflow) =>
        workflow.platform === 'n8n' ? workflowEntryPoints(workflow.raw as N8nWorkflow) : [],
      resources: (workflow: ContextWorkflow) =>
        workflow.platform === 'n8n'
          ? extractResourceRefs(workflow.raw as N8nWorkflow).filter(
              (ref) => ref.provider !== 'execute-workflow',
            )
          : [],
    };
  }
}

export type ImpactContext = Awaited<ReturnType<ImpactContextService['load']>>;
