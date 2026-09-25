import { Injectable } from '@nestjs/common';
import { EnvName, workflowFamilyKey, workflowFamilyName } from '@nwm/core';
import { PrismaListArgs } from '../../common/crud/paginate';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { LatestVersion, VersionHistoryService } from './version-history.service';

/**
 * Un workflow métier et l'état courant de chacun de ses environnements.
 * Le tableau se lit alors à trois niveaux : la famille, ses envs, et sous
 * chaque env l'historique de ses versions.
 */
export interface VersionFamilyRow {
  /** Clé de regroupement = nom métier normalisé (sert de rowKey côté UI). */
  id: string;
  name: string;
  /** Environnements représentés, dans l'ordre dev → preprod → prod. */
  envs: EnvName[];
  /** Membres dont l'env n'a pu être déduit ni du tag ni du nom. */
  unknownEnvCount: number;
  instanceIds: string[];
  memberCount: number;
  /** Versions cumulées de tous les membres. */
  versionCount: number;
  /** Date de la version la plus récente, tous envs confondus. */
  createdAt: Date;
  /** Membres dont la dernière version n'est pas encore exportée. */
  notExportedCount: number;
  members: LatestVersion[];
}

/** Ordre des membres : celui des envs déclarés, puis l'env indéterminé. */
function byEnvThenName(order: EnvName[]) {
  const rank = (env: EnvName | null) => (env ? order.indexOf(env) : order.length);
  return (a: LatestVersion, b: LatestVersion): number =>
    rank(a.env) - rank(b.env) || a.workflow.name.localeCompare(b.workflow.name);
}

/**
 * Vue groupée de l'historique : « Facturation - DEV » et « Facturation - PROD »
 * sont le même workflow métier, versionné dans deux environnements. Une ligne
 * par exemplaire répondait mal à la seule question qu'on se pose ici — « où en
 * est ce workflow, et qu'est-ce que la prod a de moins que la dev ? ».
 *
 * Le regroupement se fait côté API, comme celui de la liste Workflows : une
 * famille dont les membres tomberaient sur deux pages serait coupée en deux.
 */
@Injectable()
export class VersionFamiliesService {
  constructor(
    private readonly history: VersionHistoryService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async list(
    instanceId?: string,
    workflowId?: string,
    args: PrismaListArgs = {},
  ): Promise<{ data: VersionFamilyRow[]; total: number }> {
    // Sans pagination : c'est le regroupement qui pagine ensuite, pas les membres.
    const { data: latest } = await this.history.listLatest(instanceId, workflowId);

    const order = await this.settings.declaredEnvIds();
    const groups = new Map<string, LatestVersion[]>();
    for (const row of latest) {
      const key = workflowFamilyKey(row.workflow.name, order);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const families = [...groups.entries()].map(([key, members]) =>
      toFamily(key, [...members].sort(byEnvThenName(order)), order),
    );
    families.sort(compare(args.orderBy));

    const start = args.skip ?? 0;
    const end = args.take === undefined ? undefined : start + args.take;
    return { data: families.slice(start, end), total: families.length };
  }
}

function toFamily(id: string, members: LatestVersion[], order: EnvName[]): VersionFamilyRow {
  return {
    id,
    name: workflowFamilyName(members[0].workflow.name, order),
    envs: order.filter((env) => members.some((m) => m.env === env)),
    unknownEnvCount: members.filter((m) => m.env === null).length,
    instanceIds: [...new Set(members.map((m) => m.workflow.instanceId))],
    memberCount: members.length,
    versionCount: members.reduce((total, m) => total + m.versionCount, 0),
    createdAt: members.reduce<Date>(
      (max, m) => (m.createdAt > max ? m.createdAt : max),
      members[0].createdAt,
    ),
    notExportedCount: members.filter((m) => m.exportedAt === null).length,
    members,
  };
}

/** Tri des familles selon l'orderBy Refine (dernière version par défaut). */
function compare(orderBy: PrismaListArgs['orderBy']): (a: VersionFamilyRow, b: VersionFamilyRow) => number {
  const [field, order] = Object.entries(orderBy ?? {})[0] ?? ['createdAt', 'desc'];
  const sign = order === 'asc' ? 1 : -1;
  if (field === 'name') return (a, b) => sign * a.name.localeCompare(b.name);
  if (field === 'versionCount') return (a, b) => sign * (a.versionCount - b.versionCount);
  if (field === 'memberCount') return (a, b) => sign * (a.memberCount - b.memberCount);
  return (a, b) => sign * (a.createdAt.getTime() - b.createdAt.getTime());
}
