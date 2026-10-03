import { msg } from '../i18n';

/**
 * Étude d'impact d'un workflow : « si je touche à celui-là, qu'est-ce que j'engage ? ».
 * Rien n'est appelé dans n8n — tout se lit dans le miroir et dans ce que la plateforme
 * a déjà historisé (exécutions, erreurs, tests, sondes, appels entre workflows).
 *
 * Le niveau est DÉTERMINISTE et chaque point est nommé : un « critique » sans raison
 * se discute, un « critique parce que 4 workflows l'appellent et qu'il tourne 300 fois
 * par mois en prod » se décide. Les garde-fous (tests verts, sondes, verrou) sont
 * rendus à part : ils n'abaissent pas le niveau — ils disent qu'on le saurait vite.
 */

export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';

export const IMPACT_LEVELS: readonly ImpactLevel[] = ['low', 'medium', 'high', 'critical'];

export interface ImpactFacts {
  active: boolean;
  /** L'env est coché « surveillé » (la prod par défaut), ou indéterminé — comme pour le monitoring. */
  monitoredEnv: boolean;
  /** Workflows qui l'appellent (Execute Workflow, outil IA, webhook, lien manuel). */
  callers: number;
  executions30d: number;
  failures30d: number;
  /** Portes servies par une URL (webhook, formulaire, chat). */
  publicEntryPoints: number;
  monitors: number;
  openErrors: number;
  /** Ressources externes qu'aucun mapping d'env ne couvre : une bascule ne les suivra pas. */
  unmappedResources: number;
  testCases: number;
  redTests: number;
  locked: boolean;
}

export interface ImpactAssessment {
  level: ImpactLevel;
  score: number;
  /** Ce qui fait monter le niveau, une phrase par fait. */
  reasons: string[];
  /** Ce qui rassure sans rien abaisser. */
  safeguards: string[];
}

const LEVEL_FLOORS: Array<[ImpactLevel, number]> = [
  ['critical', 7],
  ['high', 4],
  ['medium', 2],
];

export function impactLevelOf(score: number): ImpactLevel {
  return LEVEL_FLOORS.find(([, floor]) => score >= floor)?.[0] ?? 'low';
}

export function assessImpact(facts: ImpactFacts): ImpactAssessment {
  let score = 0;
  const reasons: string[] = [];
  const safeguards: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (facts.active && facts.monitoredEnv) add(3, msg('impact.reasonLiveMonitored'));
  else if (facts.active) add(1, msg('impact.reasonActive'));
  else reasons.push(msg('impact.reasonInactive'));

  if (facts.callers > 0)
    add(facts.callers >= 3 ? 3 : 2, msg('impact.reasonCallers', { count: facts.callers }));
  if (facts.executions30d >= 100) add(2, msg('impact.reasonExecutions', { count: facts.executions30d }));
  else if (facts.executions30d >= 10) add(1, msg('impact.reasonExecutions', { count: facts.executions30d }));
  if (facts.active && facts.publicEntryPoints > 0) {
    add(1, msg('impact.reasonPublicEntry', { count: facts.publicEntryPoints }));
  }
  if (facts.openErrors > 0) add(1, msg('impact.reasonOpenErrors', { count: facts.openErrors }));
  if (facts.unmappedResources > 0) add(1, msg('impact.reasonUnmapped', { count: facts.unmappedResources }));
  if (facts.redTests > 0)
    add(1, msg('impact.reasonRedTests', { red: facts.redTests, total: facts.testCases }));

  if (facts.testCases > 0 && facts.redTests === 0) {
    safeguards.push(msg('impact.safeguardTestsGreen', { count: facts.testCases }));
  }
  if (facts.monitors > 0) safeguards.push(msg('impact.safeguardMonitors', { count: facts.monitors }));
  if (facts.locked) safeguards.push(msg('impact.safeguardLocked'));

  return { level: impactLevelOf(score), score, reasons, safeguards };
}

export interface ImpactSummaryItem {
  id: string;
  level: ImpactLevel;
  executions30d: number;
  callerIds: string[];
  resourceKeys: string[];
}

export interface ImpactSummary {
  count: number;
  byLevel: Record<ImpactLevel, number>;
  highest: ImpactLevel;
  executions30d: number;
  /** Appelants qui ne font PAS partie du lot : ceux qu'un changement du lot surprendrait. */
  externalCallers: number;
  resources: number;
}

/** Le lot vu d'en haut : combien de critiques, combien d'exécutions, qui est touché de l'extérieur. */
export function summarizeImpacts(items: readonly ImpactSummaryItem[]): ImpactSummary {
  const byLevel: Record<ImpactLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const inside = new Set(items.map((item) => item.id));
  const callers = new Set<string>();
  const resources = new Set<string>();
  let executions30d = 0;
  for (const item of items) {
    byLevel[item.level] += 1;
    executions30d += item.executions30d;
    for (const caller of item.callerIds) if (!inside.has(caller)) callers.add(caller);
    for (const key of item.resourceKeys) resources.add(key);
  }
  const highest = [...IMPACT_LEVELS].reverse().find((level) => byLevel[level] > 0) ?? 'low';
  return {
    count: items.length,
    byLevel,
    highest,
    executions30d,
    externalCallers: callers.size,
    resources: resources.size,
  };
}
