import { DEFAULT_ENVS, DEFAULT_ENV_IDS, EnvDefinition, findEnv } from './env';
import { EnvName } from './env';

/**
 * Les motifs sont bâtis à partir des envs DÉCLARÉS : reconnaître un env qui
 * n'existe pas ferait d'un « Sync - RECETTE » un env inconnu ou, pire, d'un
 * suffixe ordinaire un env. Les ids les plus longs passent en premier, pour que
 * « preprod » ne se fasse pas rogner en « prod ».
 */
function alternation(envs: readonly string[]): string {
  const ids = [...new Set(envs)].filter(Boolean).sort((a, b) => b.length - a.length);
  return ids.map((id) => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
}

function tagPattern(envs: readonly string[]): RegExp {
  return new RegExp(`^env:(${alternation(envs)})$`, 'i');
}

/** Suffixe ou segment final du nom : « Workflow 1 - DEV », « Sync [prod] », « Facturation PREPROD ». */
function namePattern(envs: readonly string[]): RegExp {
  return new RegExp(`[\\s\\-_[(](${alternation(envs)})[\\])\\s]*$`, 'i');
}

/**
 * Déduit l'environnement d'un workflow depuis ses tags (prioritaire : `env:dev`)
 * ou depuis son nom (suffixe DEV / PROD / …). Retourne null si indéterminé.
 */
export function detectWorkflowEnv(
  name: string,
  tags: string[],
  envs: readonly string[] = DEFAULT_ENV_IDS,
): EnvName | null {
  if (envs.length === 0) return null;
  const tagRe = tagPattern(envs);
  for (const tag of tags) {
    const match = tag.match(tagRe);
    if (match) return match[1].toLowerCase();
  }
  const match = name.match(namePattern(envs));
  if (match) return match[1].toLowerCase();
  return null;
}

/** "Workflow 1 - DEV" → "Workflow 1" (le nom sans son suffixe d'env, ni son séparateur). */
export function withoutEnvSuffix(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  if (envs.length === 0) return name.trim();
  return name
    .replace(namePattern(envs), '')
    .trim()
    .replace(/[\s\-_[(]+$/, '')
    .trim();
}

/** "Workflow 1 - DEV" + prod → "Workflow 1 - PROD" (retire l'ancien suffixe d'env s'il existe). */
export function withEnvSuffix(name: string, env: EnvName, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  return `${withoutEnvSuffix(name, envs)} - ${env.toUpperCase()}`;
}

/**
 * Un env à surveiller : ceux qu'on a cochés, et eux seuls. Une erreur là où l'on
 * travaille dit qu'on y travaille — la remonter réveillerait sur du travail en cours.
 * Env indéterminé ⇒ surveillé : un parc non étiqueté serait sinon muet.
 */
export function isMonitoredEnv(env: EnvName | null, envs: readonly EnvDefinition[] = DEFAULT_ENVS): boolean {
  if (env === null) return true;
  return findEnv(envs, env)?.monitored ?? false;
}
