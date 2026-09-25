import { Injectable } from '@nestjs/common';
import {
  EnvName,
  isToDeploy,
  matchesDivergenceFilter,
  workflowFamilyKey,
  workflowFamilyName,
} from '@nwm/core';
import { PrismaListArgs } from '../../common/crud/paginate';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowListFilters, WorkflowWithEnv, WorkflowsService } from './workflows.service';
import { WorkflowDivergenceService } from './workflow-divergence.service';

/**
 * Une famille : le même workflow métier, dans ses différents environnements
 * (et, après promotion, sur ses différentes instances).
 */
export interface WorkflowFamilyRow {
  /** Clé de regroupement = nom métier normalisé (sert de rowKey côté UI). */
  id: string;
  name: string;
  /** Environnements représentés, dans l'ordre dev → preprod → prod. */
  envs: EnvName[];
  /** Membres dont l'env n'a pu être déduit ni du tag ni du nom. */
  unknownEnvCount: number;
  instanceIds: string[];
  memberCount: number;
  activeCount: number;
  archivedCount: number;
  missingCount: number;
  /** Envs dont un exemplaire est à déployer vers la prod (plus récent, ou jamais déployé). */
  toDeploy: EnvName[];
  /** Au moins un exemplaire sur lequel la prod a bougé en dernier : un correctif fait là-bas. */
  prodAhead: boolean;
  /** Dernière synchro d'un membre (et non une modification). */
  updatedAt: Date;
  /** Modification la plus récente d'un membre chez la plateforme d'origine. */
  upstreamUpdatedAt: Date | null;
  members: WorkflowWithEnv[];
}

function toFamily(id: string, members: WorkflowWithEnv[], order: EnvName[]): WorkflowFamilyRow {
  const envs = order.filter((env) => members.some((m) => m.env === env));
  return {
    id,
    name: workflowFamilyName(members[0].name, order),
    envs,
    unknownEnvCount: members.filter((m) => m.env === null).length,
    instanceIds: [...new Set(members.map((m) => m.instanceId))],
    memberCount: members.length,
    activeCount: members.filter((m) => m.active).length,
    archivedCount: members.filter((m) => m.archived).length,
    missingCount: members.filter((m) => m.missingInN8n).length,
    toDeploy: order.filter((env) =>
      members.some((m) => m.env === env && m.divergence && isToDeploy(m.divergence.status)),
    ),
    prodAhead: members.some((m) => m.divergence?.status === 'behind'),
    updatedAt: members.reduce<Date>(
      (max, m) => (m.updatedAt > max ? m.updatedAt : max),
      members[0].updatedAt,
    ),
    upstreamUpdatedAt: members.reduce<Date | null>(
      (max, m) => (m.upstreamUpdatedAt && (!max || m.upstreamUpdatedAt > max) ? m.upstreamUpdatedAt : max),
      null,
    ),
    members,
  };
}

/** Ordre des membres d'une famille : celui des envs déclarés, puis l'env inconnu. */
function byEnvThenName(order: EnvName[]) {
  const rank = (env: EnvName | null) => (env ? order.indexOf(env) : order.length);
  return (a: WorkflowWithEnv, b: WorkflowWithEnv): number =>
    rank(a.env) - rank(b.env) || a.name.localeCompare(b.name);
}

/**
 * Vue groupée de la liste des workflows : « FORM -> Airtable - DEV » et
 * « FORM -> Airtable - PROD » sont le même workflow, vu dans deux environnements.
 *
 * Le regroupement se fait ici et non dans l'UI : une famille dont les membres
 * tomberaient sur deux pages différentes serait coupée en deux.
 */
@Injectable()
export class WorkflowFamiliesService {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly settings: PlatformSettingsService,
    private readonly divergence: WorkflowDivergenceService,
  ) {}

  async list(
    args: PrismaListArgs,
    filters: WorkflowListFilters,
  ): Promise<{ data: WorkflowFamilyRow[]; total: number }> {
    const workflows = await this.divergence.annotate(await this.workflows.listAll(filters));
    const order = await this.settings.declaredEnvIds();
    const groups = new Map<string, WorkflowWithEnv[]>();
    for (const workflow of workflows) {
      const key = workflowFamilyKey(workflow.name, order);
      groups.set(key, [...(groups.get(key) ?? []), workflow]);
    }
    const families = [...groups.entries()]
      .map(([key, members]) => toFamily(key, [...members].sort(byEnvThenName(order)), order))
      .filter(
        (family) =>
          !filters.divergence ||
          family.members.some((m) => matchesDivergenceFilter(filters.divergence!, m.env, m.divergence)),
      );
    families.sort(compare(args.orderBy));

    const start = args.skip ?? 0;
    const end = args.take === undefined ? undefined : start + args.take;
    return { data: families.slice(start, end), total: families.length };
  }

  /**
   * Les autres membres de la famille d'un workflow : le même workflow métier
   * dans ses autres environnements (et sur ses autres instances).
   *
   * Le workflow de départ peut être archivé ou supprimé dans n8n sans que ses
   * frères disparaissent : il est lu à l'unité, eux suivent le filtre global.
   */
  async siblings(id: string): Promise<WorkflowWithEnv[]> {
    const workflow = await this.workflows.get(id);
    const order = await this.settings.declaredEnvIds();
    const key = workflowFamilyKey(workflow.name, order);
    const all = await this.workflows.listAll({});
    return all
      .filter((w) => w.id !== id && workflowFamilyKey(w.name, order) === key)
      .sort(byEnvThenName(order));
  }
}

/** Tri des familles selon l'orderBy Refine (nom par défaut). */
function compare(orderBy: PrismaListArgs['orderBy']): (a: WorkflowFamilyRow, b: WorkflowFamilyRow) => number {
  const [field, order] = Object.entries(orderBy ?? {})[0] ?? ['name', 'asc'];
  const sign = order === 'desc' ? -1 : 1;
  if (field === 'updatedAt') return (a, b) => sign * (a.updatedAt.getTime() - b.updatedAt.getTime());
  if (field === 'upstreamUpdatedAt')
    return (a, b) => sign * ((a.upstreamUpdatedAt?.getTime() ?? 0) - (b.upstreamUpdatedAt?.getTime() ?? 0));
  if (field === 'memberCount') return (a, b) => sign * (a.memberCount - b.memberCount);
  return (a, b) => sign * a.name.localeCompare(b.name);
}
