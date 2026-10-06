import { DEFAULT_ENV_IDS } from '../env';
import { RenameSpec, safeRenameNodes } from './safe-rename';
import { N8nWorkflow } from './workflow.types';

/** Échappe un id d'env pour une alternance de regex ; les plus longs d'abord (« preprod » avant « prod »). */
function alternation(envs: readonly string[]): string {
  const ids = [...new Set(envs)].filter(Boolean).sort((a, b) => b.length - a.length);
  return ids.map((id) => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
}

const VERSION = /\s*(?:\(\s*v?\d+\.\d+\.\d+\s*\)|\[\s*v?\d+\.\d+\.\d+\s*\]|\bv\d+\.\d+\.\d+\b)/gi;

/**
 * Nom d'un nœud débarrassé de ce qui varie d'un env à l'autre : le suffixe d'env et
 * le numéro de version, OÙ QU'ILS SOIENT. Un nœud qui appelle un sous-workflow porte
 * souvent son nom — « Call 'Facturation (1.2.2) - DEV' » —, donc l'env et le numéro
 * y sont au milieu, devant la quote, et non en fin de nom comme pour un workflow.
 */
export function neutralNodeName(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  let result = name.replace(VERSION, '');
  if (envs.length > 0) {
    const env = new RegExp(
      `\\s*(?:[-_]\\s*|\\s)[[(]?(?:${alternation(envs)})[\\])]?(?=$|['"\`\\])\\s\\-_])`,
      'gi',
    );
    result = result.replace(env, '');
  }
  result = result.trim();
  return result || name;
}

/**
 * Renomme chaque nœud sous son nom neutre, connexions et expressions comprises
 * (`safeRenameNodes`) : « Call 'X - PROD' » et « Call 'X - DEV' » deviennent le même
 * nœud, et `$('Call \'X - PROD\'')` la même référence. Un nom neutre qui en rejoindrait
 * un autre n'est pas appliqué : deux nœuds fusionnés fausseraient le diff au lieu
 * de le nettoyer.
 */
export function withNeutralNodeNames(
  workflow: N8nWorkflow,
  envs: readonly string[] = DEFAULT_ENV_IDS,
): N8nWorkflow {
  const nodes = workflow.nodes ?? [];
  const neutral = new Map(nodes.map((node) => [node.name, neutralNodeName(node.name, envs)]));
  const counts = new Map<string, number>();
  for (const name of neutral.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const renames: RenameSpec[] = [];
  for (const [oldName, newName] of neutral) {
    if (oldName !== newName && counts.get(newName) === 1) {
      renames.push({ oldName, newName });
      // `$('Call \'X\'')` : l'éditeur échappe la quote d'un nom qui en porte.
      const escape = (name: string): string => name.replace(/'/g, "\\'");
      if (oldName.includes("'")) renames.push({ oldName: escape(oldName), newName: escape(newName) });
    }
  }
  return renames.length > 0 ? safeRenameNodes(workflow, renames) : workflow;
}
