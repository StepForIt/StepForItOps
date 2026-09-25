import { N8nWorkflow, applyDeepReplace, relabelCredentials, relabelResourceLocators } from '@nwm/core';
import { MappingLabels, MappingValues, buildLabelMap, buildReplacements } from './mapping-replacements';

/** Un ResourceMapping réduit à ce dont la bascule a besoin. */
export interface Mapping {
  values: MappingValues;
  labels?: MappingLabels;
}

/** Lignes `ResourceMapping` de Prisma, réduites à ce que la bascule lit. */
export function toSwitchMappings(rows: Array<{ values: unknown; labels: unknown }>): Mapping[] {
  return rows.map((row) => ({
    values: row.values as MappingValues,
    labels: (row.labels ?? undefined) as MappingLabels | undefined,
  }));
}

export interface SwitchOutcome {
  workflow: N8nWorkflow;
  /** Ids de ressources effectivement remplacés. */
  replacements: number;
  /** Libellés remis à jour (nom affiché par n8n), par nœud. */
  relabeled: Array<{ nodeName: string; from: string; to: string }>;
}

/**
 * Bascule les ressources d'un workflow vers `targetEnv` : remplacement des ids,
 * PUIS remise à jour des noms affichés. Les deux vont ensemble — un id changé
 * sous un nom inchangé donne un workflow qui tape la bonne base en en affichant
 * une autre, et c'est ce nom-là qu'on lit dans l'éditeur pour décider.
 */
export function switchResources(
  raw: N8nWorkflow,
  mappings: Mapping[],
  targetEnv: string,
  /** Ids des envs déclarés : ce sont eux qu'une estampille « CRM (dev) » peut porter. */
  envs?: readonly string[],
): SwitchOutcome {
  const replacements = mappings.flatMap((mapping) => buildReplacements(mapping.values, targetEnv));
  const serialized = JSON.stringify(raw);
  const applied = replacements.filter((r) => serialized.includes(r.from));
  const switched = applyDeepReplace(raw, replacements);

  const labels = new Map<string, string>();
  for (const mapping of mappings) {
    for (const [id, label] of buildLabelMap(mapping.values, mapping.labels, targetEnv)) labels.set(id, label);
  }
  const switchedIds = new Set(applied.map((r) => r.to));
  const located = relabelResourceLocators(switched, labels, targetEnv, switchedIds, envs);
  // Les credentials sont rangées hors des paramètres : même correction, autre forme.
  const credentialed = relabelCredentials(located.workflow, labels, targetEnv, switchedIds, envs);

  return {
    workflow: credentialed.workflow,
    replacements: applied.length,
    relabeled: [...located.relabeled, ...credentialed.relabeled],
  };
}
