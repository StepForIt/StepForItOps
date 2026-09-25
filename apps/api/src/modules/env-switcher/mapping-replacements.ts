import { Replacement } from '@nwm/core';

/** values d'un ResourceMapping : { dev: {...}, preprod: {...}, prod: {...} } */
export type MappingValues = Record<string, Record<string, unknown>>;

/** labels d'un ResourceMapping : mêmes clés que values, mais les noms lisibles. */
export type MappingLabels = Record<string, Record<string, unknown>>;

/**
 * Titre de chaque ressource de l'env cible, par id : c'est ce qui permet de
 * remettre à jour le nom affiché par n8n après le remplacement. Un mapping saisi
 * à la main n'a pas de titres — la table sort alors vide, et le repli s'applique.
 */
export function buildLabelMap(
  values: MappingValues,
  labels: MappingLabels | undefined,
  targetEnv: string,
): Map<string, string> {
  const ids = values[targetEnv];
  const names = labels?.[targetEnv];
  const map = new Map<string, string>();
  if (!ids || !names) return map;
  for (const [key, id] of Object.entries(ids)) {
    const name = names[key];
    if (typeof id === 'string' && typeof name === 'string' && name.length > 0) map.set(id, name);
  }
  return map;
}

function flattenIds(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.length >= 4) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => flattenIds(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => flattenIds(v, out));
  }
  return out;
}

/**
 * Construit les remplacements vers `targetEnv` : pour chaque clé du mapping,
 * toute valeur d'un AUTRE environnement est remplacée par la valeur cible.
 * Les structures sont alignées par clé (ex: values.dev.baseId ↔ values.prod.baseId).
 */
export function buildReplacements(values: MappingValues, targetEnv: string): Replacement[] {
  const target = values[targetEnv];
  if (!target) return [];
  const replacements: Replacement[] = [];

  const walk = (targetValue: unknown, otherValue: unknown): void => {
    if (typeof targetValue === 'string' && typeof otherValue === 'string') {
      if (otherValue !== targetValue && otherValue.length >= 4) {
        replacements.push({ from: otherValue, to: targetValue });
      }
    } else if (
      targetValue &&
      otherValue &&
      typeof targetValue === 'object' &&
      typeof otherValue === 'object' &&
      !Array.isArray(targetValue) &&
      !Array.isArray(otherValue)
    ) {
      for (const key of Object.keys(targetValue as Record<string, unknown>)) {
        walk((targetValue as Record<string, unknown>)[key], (otherValue as Record<string, unknown>)[key]);
      }
    }
  };

  for (const [env, envValues] of Object.entries(values)) {
    if (env === targetEnv) continue;
    walk(target, envValues);
  }

  // Dédoublonne (un même id source peut apparaître dans plusieurs envs)
  const seen = new Set<string>();
  return replacements.filter((r) => {
    if (seen.has(r.from)) return false;
    seen.add(r.from);
    return true;
  });
}

/** Ids connus (tous envs confondus) — utile pour détecter la présence d'un mapping. */
export function allKnownIds(values: MappingValues): string[] {
  return flattenIds(values);
}

/**
 * Compte, pour chaque environnement du mapping, combien de ses ids apparaissent
 * dans le JSON du workflow → permet de détecter l'env COURANT d'un workflow
 * (l'env n'est pas une identité : le même workflow peut être branché dev ou prod).
 */
export function countEnvMatches(serializedWorkflow: string, values: MappingValues): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [env, envValues] of Object.entries(values)) {
    counts[env] = flattenIds(envValues).filter((id) => serializedWorkflow.includes(id)).length;
  }
  return counts;
}
