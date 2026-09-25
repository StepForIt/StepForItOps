import { EnvName, workflowFamilyKey, workflowFamilyName } from '@nwm/core';
import type { WorkflowCost } from './ai-cost.service';

/** Le même workflow métier, ses environnements dessous : leurs coûts cumulés. */
export interface WorkflowCostFamily {
  /** Clé de regroupement = nom métier normalisé (sert de rowKey côté UI). */
  id: string;
  name: string;
  /** Environnements représentés, dans l'ordre dev → preprod → prod. */
  envs: EnvName[];
  /** Membres dont l'env n'a pu être déduit ni du tag ni du nom. */
  unknownEnvCount: number;
  memberCount: number;
  calls: number;
  executions: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedCalls: number;
  lastAt: string | null;
  members: WorkflowCost[];
}

/**
 * Regroupe les coûts par workflow MÉTIER. Le total de la page ne bouge pas :
 * un appel LLM en dev est une dépense réelle, l'écarter ferait mentir la
 * facture. C'est la LECTURE qui change — « ce workflow me coûte X, dont tant
 * en mise au point » se lit sur une ligne, là où deux exemplaires d'un même
 * workflow tombaient chacun de leur côté du classement et paraissaient tous
 * les deux modestes.
 */
export function groupCostsByFamily(
  workflows: WorkflowCost[],
  /** Ordre des envs déclarés : il range les membres et les envs de la famille. */
  order: EnvName[] = [],
): WorkflowCostFamily[] {
  const groups = new Map<string, WorkflowCost[]>();
  for (const workflow of workflows) {
    const key = workflowFamilyKey(workflow.name, order);
    groups.set(key, [...(groups.get(key) ?? []), workflow]);
  }
  return [...groups.entries()]
    .map(([key, members]) => toFamily(key, [...members].sort(byEnvThenName(order)), order))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function toFamily(id: string, members: WorkflowCost[], order: EnvName[]): WorkflowCostFamily {
  const sum = (pick: (m: WorkflowCost) => number) => members.reduce((t, m) => t + pick(m), 0);
  const dates = members.map((m) => m.lastAt).filter((d): d is string => d !== null);
  return {
    id,
    name: workflowFamilyName(members[0].name, order),
    envs: order.filter((env) => members.some((m) => m.env === env)),
    unknownEnvCount: members.filter((m) => m.env === null).length,
    memberCount: members.length,
    calls: sum((m) => m.calls),
    executions: sum((m) => m.executions),
    promptTokens: sum((m) => m.promptTokens),
    completionTokens: sum((m) => m.completionTokens),
    costUsd: sum((m) => m.costUsd),
    unpricedCalls: sum((m) => m.unpricedCalls),
    lastAt: dates.length > 0 ? dates.reduce((max, d) => (d > max ? d : max)) : null,
    members,
  };
}

/** Ordre des membres : celui des envs déclarés, puis l'env indéterminé. */
function byEnvThenName(order: EnvName[]) {
  const rank = (env: EnvName | null) => (env ? order.indexOf(env) : order.length);
  return (a: WorkflowCost, b: WorkflowCost): number =>
    rank(a.env) - rank(b.env) || a.name.localeCompare(b.name);
}
