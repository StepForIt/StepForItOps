import { Injectable, NotFoundException } from '@nestjs/common';
import { EnvName, N8nWorkflow, WorkflowDiff, detectWorkflowEnv, diffWorkflows, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { PrismaListArgs } from '../../common/crud/paginate';

/** Dernière version d'un workflow, avec la profondeur de son historique. */
export interface LatestVersion {
  id: string;
  workflowId: string;
  workflow: { name: string; instanceId: string };
  /** Env du workflow, déduit de son nom ou de ses tags — null si indéterminé. */
  env: EnvName | null;
  hash: string;
  origin: string;
  message: string | null;
  createdAt: Date;
  exportedAt: Date | null;
  exportedTo: string[];
  /** Nombre total de versions du workflow (dont celle-ci). */
  versionCount: number;
  /** Date de la version précédente, s'il y en a une. */
  previousAt: Date | null;
}

/** Ce qui a changé entre une version et celle qui la précède. */
export interface VersionDiff {
  version: { id: string; hash: string; createdAt: Date; origin: string };
  previous: { id: string; hash: string; createdAt: Date; origin: string } | null;
  workflow: { id: string; name: string };
  diff: WorkflowDiff | null;
}

/**
 * Deux lectures de l'historique que la liste à plat ne donne pas : l'état
 * COURANT de chaque workflow (une ligne par workflow, pas une par snapshot —
 * un workflow qui bouge toutes les heures noyait tous les autres), et le
 * détail de ce qui a bougé d'une version à la suivante.
 */
@Injectable()
export class VersionHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Une ligne par workflow : sa dernière version. Le repliage se fait en
   * mémoire APRÈS avoir groupé — Prisma ne sait pas trier sur le nom du
   * workflow dans un `groupBy`, et le nombre de workflows se compte en
   * centaines, jamais en dizaines de milliers de versions.
   */
  async listLatest(
    instanceId?: string,
    workflowId?: string,
    args: PrismaListArgs = {},
  ): Promise<{ data: LatestVersion[]; total: number }> {
    const where = {
      ...(workflowId ? { workflowId } : {}),
      workflow: { ...(instanceId ? { instanceId } : {}), ...(await this.settings.workflowFilter()) },
    };

    const groups = await this.prisma.workflowVersion.groupBy({
      by: ['workflowId'],
      where,
      _max: { createdAt: true },
      _count: { _all: true },
    });
    if (groups.length === 0) return { data: [], total: 0 };

    const latest = await this.prisma.workflowVersion.findMany({
      where: {
        OR: groups.map((group) => ({
          workflowId: group.workflowId,
          createdAt: group._max.createdAt as Date,
        })),
      },
      include: { workflow: { select: { name: true, instanceId: true, tags: true } } },
    });
    const counts = new Map(groups.map((group) => [group.workflowId, group._count._all]));

    // Date de l'avant-dernière version : c'est elle que la comparaison prendra.
    const previous = await this.prisma.workflowVersion.groupBy({
      by: ['workflowId'],
      where: { ...where, NOT: { id: { in: latest.map((version) => version.id) } } },
      _max: { createdAt: true },
    });
    const previousAt = new Map(previous.map((group) => [group.workflowId, group._max.createdAt]));
    const envs = await this.settings.declaredEnvIds();

    const rows: LatestVersion[] = latest.map((version) => ({
      id: version.id,
      workflowId: version.workflowId,
      workflow: { name: version.workflow.name, instanceId: version.workflow.instanceId },
      env: detectWorkflowEnv(version.workflow.name, version.workflow.tags, envs),
      hash: version.hash,
      origin: version.origin,
      message: version.message,
      createdAt: version.createdAt,
      exportedAt: version.exportedAt,
      exportedTo: version.exportedTo,
      versionCount: counts.get(version.workflowId) ?? 1,
      previousAt: previousAt.get(version.workflowId) ?? null,
    }));

    return { data: paginate(rows, args), total: rows.length };
  }

  /** Ce que cette version a changé par rapport à celle qui la précède. */
  async diffWithPrevious(versionId: string): Promise<VersionDiff> {
    const version = await this.prisma.workflowVersion.findUnique({
      where: { id: versionId },
      include: { workflow: { select: { id: true, name: true } } },
    });
    if (!version) throw new NotFoundException(msg('platform.versionNotFound', { id: versionId }));

    const previous = await this.prisma.workflowVersion.findFirst({
      where: { workflowId: version.workflowId, createdAt: { lt: version.createdAt } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      version: {
        id: version.id,
        hash: version.hash,
        createdAt: version.createdAt,
        origin: version.origin,
      },
      previous: previous && {
        id: previous.id,
        hash: previous.hash,
        createdAt: previous.createdAt,
        origin: previous.origin,
      },
      workflow: version.workflow,
      diff: previous
        ? diffWorkflows(previous.raw as unknown as N8nWorkflow, version.raw as unknown as N8nWorkflow)
        : null,
    };
  }
}

/** Tri + tranche demandés par Refine, appliqués aux lignes déjà repliées. */
function paginate(rows: LatestVersion[], args: PrismaListArgs): LatestVersion[] {
  const sorted = [...rows].sort(compareBy(args.orderBy));
  const skip = args.skip ?? 0;
  return args.take !== undefined ? sorted.slice(skip, skip + args.take) : sorted.slice(skip);
}

function compareBy(orderBy: PrismaListArgs['orderBy']): (a: LatestVersion, b: LatestVersion) => number {
  const [field, direction] = flatten(orderBy) ?? ['createdAt', 'desc'];
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const left = valueOf(a, field);
    const right = valueOf(b, field);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left < right ? -1 : 1) * sign;
  };
}

/** `{ workflow: { name: 'asc' } }` → `['workflow.name', 'asc']`. */
function flatten(orderBy: PrismaListArgs['orderBy']): [string, string] | null {
  if (!orderBy) return null;
  const [key, value] = Object.entries(orderBy)[0] ?? [];
  if (key === undefined) return null;
  if (typeof value === 'string') return [key, value];
  const nested = flatten(value);
  return nested ? [`${key}.${nested[0]}`, nested[1]] : null;
}

function valueOf(row: LatestVersion, field: string): string | number | null {
  switch (field) {
    case 'workflow.name':
      return row.workflow.name.toLowerCase();
    case 'origin':
      return row.origin;
    case 'versionCount':
      return row.versionCount;
    case 'exportedAt':
      return row.exportedAt?.getTime() ?? null;
    default:
      return row.createdAt.getTime();
  }
}
