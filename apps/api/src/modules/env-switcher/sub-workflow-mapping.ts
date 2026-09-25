import {
  EnvName,
  N8nWorkflow,
  SubWorkflowRef,
  SubWorkflowTarget,
  envFamilyKey,
  withEnvSuffix,
} from '@nwm/core';

/**
 * Sort d'un sous-workflow appelé, une fois cherché sa contrepartie sur la cible :
 * `mapped` = remappé, `unchanged` = déjà la bonne cible (ou rien à changer),
 * `missing` = la contrepartie n'existe pas, `dynamic` = id construit par expression.
 */
export type SubWorkflowStatus = 'mapped' | 'unchanged' | 'missing' | 'dynamic';

export interface SubWorkflowMapping {
  nodeName: string;
  kind: SubWorkflowRef['kind'];
  sourceN8nId: string;
  /** Nom du sous-workflow côté source (DB de la plateforme, sinon nom affiché par n8n). */
  sourceName?: string;
  /** Nom attendu sur la cible (suffixé par l'env quand un env cible est demandé). */
  targetName?: string;
  targetN8nId?: string;
  /** La contrepartie existe sur la cible mais y est archivée : n8n n'exécute plus un archivé. */
  targetArchived?: boolean;
  status: SubWorkflowStatus;
}

/** Workflow existant sur la cible, réduit à ce qui sert à le retrouver par nom. */
export interface TargetWorkflow {
  externalId: string;
  name: string;
  /** Archivage natif n8n : le workflow existe encore, mais n'est ni modifiable ni exécutable. */
  archived?: boolean;
}

export function targetWorkflows(workflows: N8nWorkflow[]): TargetWorkflow[] {
  return workflows
    .filter((w) => w.id !== undefined)
    .map((w) => ({ externalId: String(w.id), name: w.name, archived: w.isArchived === true }));
}

/**
 * Rapproche chaque sous-workflow appelé de sa contrepartie sur la cible, **par nom**
 * — la même convention que la promotion elle-même : « Facturation » + env dev donne
 * « Facturation - DEV ». Sans env cible, on cherche le même nom sur l'autre instance.
 */
export function resolveSubWorkflows(
  refs: SubWorkflowRef[],
  options: {
    /** Nom du sous-workflow côté source, par id n8n (DB de la plateforme). */
    sourceNames: Map<string, string>;
    targets: TargetWorkflow[];
    targetEnv?: EnvName;
    /** Vrai quand la cible EST l'instance source (duplication sur place). */
    sameInstance: boolean;
    /** Ids des envs déclarés : ce sont eux que le nom d'un exemplaire peut porter. */
    envs?: readonly string[];
  },
): SubWorkflowMapping[] {
  // Même nom en double sur la cible (un archivé, un vivant) : c'est le vivant qui compte.
  const byName = new Map<string, TargetWorkflow>();
  // Second index, sans le numéro de version : un sous-workflow monté en « (1.2.1) »
  // en dev garde une contrepartie en « (1.1.4) » en prod — c'est même la situation
  // ordinaire, puisque la prod est en retard d'une promotion. À nom exact près, le
  // manquer faisait bloquer la promotion ou créer un doublon en cascade.
  const byFamily = new Map<string, TargetWorkflow>();
  for (const target of options.targets) {
    const kept = byName.get(target.name);
    if (!kept || (kept.archived && !target.archived)) byName.set(target.name, target);
    const key = envFamilyKey(target.name, options.envs);
    const keptFamily = byFamily.get(key);
    if (!keptFamily || (keptFamily.archived && !target.archived)) byFamily.set(key, target);
  }
  const mappings: SubWorkflowMapping[] = [];

  for (const ref of refs) {
    const base = { nodeName: ref.nodeName, kind: ref.kind, sourceN8nId: ref.externalId };
    if (ref.dynamic) {
      mappings.push({ ...base, status: 'dynamic' });
      continue;
    }

    const sourceName = options.sourceNames.get(ref.externalId) ?? ref.label;
    // Sur place et sans env cible, il n'y a pas d'autre exemplaire à viser.
    if (options.sameInstance && !options.targetEnv) {
      mappings.push({ ...base, sourceName, status: 'unchanged' });
      continue;
    }
    if (!sourceName) {
      mappings.push({ ...base, status: 'missing' });
      continue;
    }

    const expected = options.targetEnv
      ? withEnvSuffix(sourceName, options.targetEnv, options.envs)
      : sourceName;
    const target = byName.get(expected) ?? byFamily.get(envFamilyKey(expected, options.envs));
    mappings.push({
      ...base,
      sourceName,
      // Le nom de la contrepartie RÉELLE quand elle existe : c'est lui qui part dans
      // le `cachedResultName` du nœud, et que l'écran doit montrer.
      targetName: target?.name ?? expected,
      targetN8nId: target?.externalId,
      targetArchived: target?.archived || undefined,
      status: !target ? 'missing' : target.externalId === ref.externalId ? 'unchanged' : 'mapped',
    });
  }

  return mappings;
}

/** Table de réécriture (id source → cible) tirée des rapprochements aboutis. */
export function subWorkflowTargets(mappings: SubWorkflowMapping[]): Map<string, SubWorkflowTarget> {
  const targets = new Map<string, SubWorkflowTarget>();
  for (const mapping of mappings) {
    if (mapping.status !== 'mapped' || !mapping.targetN8nId) continue;
    targets.set(mapping.sourceN8nId, { externalId: mapping.targetN8nId, name: mapping.targetName });
  }
  return targets;
}

/** Sous-workflows qu'on ne sait pas rattacher : ils partiront pointés sur l'id d'origine. */
export function unresolvedSubWorkflows(mappings: SubWorkflowMapping[]): SubWorkflowMapping[] {
  return mappings.filter((m) => m.status === 'missing' || m.status === 'dynamic');
}
