import { DEFAULT_ENVS, EnvDefinition, PROD_ENV_ID, findEnv } from './env';
import { EnvName } from './env';

/**
 * Un chemin de promotion, du plus amont au plus aval. Ce n'est plus une liste
 * unique : chaque env déclare DE QUI il dépend (`after`), ce qui autorise des
 * branches — une recette par client repart de la même dev sans passer par la
 * preprod de la maison.
 */
export type EnvChain = EnvName[];

/**
 * `warn` : sauter une étape s'annonce et se confirme. `block` : la promotion est
 * refusée, et un env aval ne se modifie plus qu'en y promouvant depuis l'amont.
 */
export type EnvChainMode = 'warn' | 'block';

export type PromotionDirection = 'forward' | 'backward' | 'same' | 'unknown';

export interface EnvChainPlan {
  direction: PromotionDirection;
  /**
   * Étapes de la source à la cible, cible COMPRISE : promouvoir dev → prod avec
   * une preprod entre les deux donne `['preprod', 'prod']`. Vide si le chemin est inconnu.
   */
  steps: EnvName[];
  /** Étapes déclarées qu'une promotion directe saute (les `steps` sauf la cible). */
  skipped: EnvName[];
}

/** L'env dont celui-ci dépend, ou null s'il est une racine. */
export function upstreamEnv(envs: readonly EnvDefinition[], id: EnvName | null): EnvName | null {
  return findEnv(envs, id)?.after ?? null;
}

/**
 * De la racine jusqu'à `id` inclus. Le garde-fou sur les visités n'est pas
 * théorique : une déclaration éditée à la main peut boucler.
 */
export function envLineage(envs: readonly EnvDefinition[], id: EnvName | null): EnvName[] {
  const lineage: EnvName[] = [];
  const seen = new Set<EnvName>();
  let current = findEnv(envs, id)?.id ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    lineage.unshift(current);
    current = upstreamEnv(envs, current);
  }
  return lineage;
}

/** Les envs qui dépendent directement de celui-ci. */
export function downstreamEnvs(envs: readonly EnvDefinition[], id: EnvName): EnvDefinition[] {
  return envs.filter((env) => env.after === id);
}

/**
 * L'étape que propose une promotion par défaut : le premier env déclaré qui
 * dépend de la source. Rien au bout de la chaîne ni pour un env qu'on ne sait pas situer.
 */
export function nextEnv(envs: readonly EnvDefinition[], from: EnvName | null): EnvName | null {
  const source = findEnv(envs, from);
  return source ? (downstreamEnvs(envs, source.id)[0]?.id ?? null) : null;
}

/**
 * Ce que la déclaration dit d'une promotion `from` → `to`. Un env indéterminé
 * (ni tag `env:*` ni suffixe de nom), inconnu, ou situé sur une AUTRE branche rend
 * le chemin `unknown` : on ne reproche pas de sauter une étape qu'on est incapable
 * de situer, et deux branches sœurs ne se doivent rien.
 */
export function envChainPlan(
  envs: readonly EnvDefinition[],
  from: EnvName | null,
  to: EnvName | null,
): EnvChainPlan {
  const empty = { steps: [], skipped: [] };
  if (!from || !to || !findEnv(envs, from) || !findEnv(envs, to)) {
    return { direction: 'unknown', ...empty };
  }
  if (from === to) return { direction: 'same', ...empty };
  const lineage = envLineage(envs, to);
  const start = lineage.indexOf(from);
  if (start !== -1) {
    const steps = lineage.slice(start + 1);
    return { direction: 'forward', steps, skipped: steps.slice(0, -1) };
  }
  // Retour en arrière (prod → dev) : c'est un rapatriement, pas une release ; il
  // n'y a rien à traverser, et rien à reprocher non plus.
  if (envLineage(envs, from).includes(to)) return { direction: 'backward', ...empty };
  return { direction: 'unknown', ...empty };
}

/**
 * Un env aval ne se modifie qu'en y promouvant (mode `block`). Un env racine est
 * celui où l'on travaille ; un env inconnu n'est régi par rien.
 */
export function isDownstreamEnv(envs: readonly EnvDefinition[], env: EnvName | null): boolean {
  return upstreamEnv(envs, env) !== null;
}

/**
 * Reprise d'une chaîne linéaire (l'ancien réglage `envChain`) : chaque env prend
 * le précédent pour amont.
 */
export function envsFromChain(chain: readonly string[]): EnvDefinition[] {
  return chain.map((id, index) => {
    const preset = DEFAULT_ENVS.find((env) => env.id === id);
    return {
      id,
      label: preset?.label ?? id.toUpperCase(),
      color: preset?.color ?? 'blue',
      monitored: preset?.monitored ?? id === PROD_ENV_ID,
      canonicalWebhookPath: preset?.canonicalWebhookPath ?? id === PROD_ENV_ID,
      after: index > 0 ? chain[index - 1] : null,
    };
  });
}
