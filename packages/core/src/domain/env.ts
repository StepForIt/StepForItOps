/**
 * Les environnements sont DÉCLARÉS, pas connus d'avance : « dev » et « prod »
 * sont les deux bouts obligatoires, tout ce qui vit entre eux (preprod, recette,
 * un env par client) s'ajoute, se renomme et se réordonne depuis les réglages.
 *
 * Ce que la plateforme réservait à la prod se coche donc par env : un nouvel env
 * n'a rien de coché, et rien ne le distingue tant qu'on ne l'a pas dit.
 */

export interface EnvDefinition {
  /** Slug : ce qui s'écrit dans le tag `env:<id>` et dans le suffixe de nom (« X - RECETTE »). */
  id: string;
  /** Libellé affiché ; vide ⇒ l'id en majuscules. */
  label: string;
  /** Couleur du tag (palette Ant Design). */
  color: string;
  /** Ses erreurs sont remontées par le monitoring et les alertes. */
  monitored: boolean;
  /** Ses webhooks portent le path canonique, sans suffixe d'env : c'est l'URL publique. */
  canonicalWebhookPath: boolean;
  /**
   * L'env dont celui-ci dépend — ce qu'on y promeut vient de là. `null` pour la
   * racine (`dev`). C'est ce lien, et non l'ordre de la liste, qui décrit la
   * chaîne : deux envs peuvent repartir du même amont (une recette par client).
   */
  after: string | null;
}

/** Premier et dernier maillon : ils ne se suppriment pas, et ne changent pas de place. */
export const FIRST_ENV_ID = 'dev';
export const PROD_ENV_ID = 'prod';

export const DEFAULT_ENVS: EnvDefinition[] = [
  { id: 'dev', label: 'DEV', color: 'green', monitored: false, canonicalWebhookPath: false, after: null },
  {
    id: 'preprod',
    label: 'PREPROD',
    color: 'orange',
    monitored: false,
    canonicalWebhookPath: false,
    after: 'dev',
  },
  { id: 'prod', label: 'PROD', color: 'red', monitored: true, canonicalWebhookPath: true, after: 'preprod' },
];

export const DEFAULT_ENV_IDS: string[] = DEFAULT_ENVS.map((env) => env.id);

/** Couleurs proposées à un env créé, dans l'ordre où on les sert. */
const PALETTE = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'gold', 'red'];

/**
 * Un id d'env se retrouve dans un tag n8n, dans un suffixe de nom et dans une URL
 * de webhook : on le borne aux caractères qui passent partout.
 */
export function slugifyEnvId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function coerce(input: unknown, index: number): EnvDefinition | null {
  const raw = typeof input === 'string' ? { id: input } : (input as Partial<EnvDefinition> | null);
  if (!raw || typeof raw !== 'object') return null;
  const id = slugifyEnvId(String(raw.id ?? ''));
  if (!id) return null;
  const preset = DEFAULT_ENVS.find((env) => env.id === id);
  return {
    id,
    label: String(raw.label ?? '').trim() || preset?.label || id.toUpperCase(),
    color: String(raw.color ?? '').trim() || preset?.color || PALETTE[index % PALETTE.length],
    // Un env créé n'a rien de coché : c'est la déclaration qui lui donne un rôle.
    monitored: raw.monitored === undefined ? Boolean(preset?.monitored) : Boolean(raw.monitored),
    canonicalWebhookPath:
      raw.canonicalWebhookPath === undefined
        ? Boolean(preset?.canonicalWebhookPath)
        : Boolean(raw.canonicalWebhookPath),
    after:
      raw.after === undefined ? (preset?.after ?? null) : raw.after ? slugifyEnvId(String(raw.after)) : null,
  };
}

/**
 * Liste utilisable : ids valides, sans doublon, `dev` en tête et `prod` en queue
 * (rétablis s'ils manquent). Une liste vide rendrait tout chemin de promotion
 * inconnu, donc tout contrôle silencieux : on retombe alors sur la liste par défaut.
 */
export function normalizeEnvs(input: unknown): EnvDefinition[] {
  const list = Array.isArray(input) ? input : null;
  if (!list) return DEFAULT_ENVS.map((env) => ({ ...env }));
  const seen = new Set<string>();
  const kept: EnvDefinition[] = [];
  list.forEach((item, index) => {
    const env = coerce(item, index);
    if (!env || seen.has(env.id)) return;
    seen.add(env.id);
    kept.push(env);
  });
  if (kept.length === 0) return DEFAULT_ENVS.map((env) => ({ ...env }));
  const first = kept.find((env) => env.id === FIRST_ENV_ID) ?? coerce(FIRST_ENV_ID, 0)!;
  const last = kept.find((env) => env.id === PROD_ENV_ID) ?? coerce(PROD_ENV_ID, 0)!;
  const middle = kept.filter((env) => env.id !== FIRST_ENV_ID && env.id !== PROD_ENV_ID);
  return linkUpstreams([first, ...middle, last]);
}

/**
 * Chaque env doit dépendre d'un env qui EXISTE, et la remontée doit finir : un
 * amont inconnu, une boucle ou un env qui se désigne lui-même retombent sur
 * l'env précédent de la liste, faute de quoi la chaîne ne dirait plus rien.
 */
function linkUpstreams(envs: EnvDefinition[]): EnvDefinition[] {
  const ids = new Set(envs.map((env) => env.id));
  const linked = envs.map((env, index) => {
    const fallback = index === 0 ? null : envs[index - 1].id;
    const after = env.after && env.after !== env.id && ids.has(env.after) ? env.after : fallback;
    return { ...env, after: index === 0 ? null : after };
  });
  const byId = new Map(linked.map((env) => [env.id, env]));
  return linked.map((env, index) => {
    const seen = new Set<string>([env.id]);
    let cursor = env.after;
    while (cursor) {
      if (seen.has(cursor)) return { ...env, after: index === 0 ? null : linked[index - 1].id };
      seen.add(cursor);
      cursor = byId.get(cursor)?.after ?? null;
    }
    return env;
  });
}

export function envIds(envs: readonly EnvDefinition[]): string[] {
  return envs.map((env) => env.id);
}

export function findEnv(envs: readonly EnvDefinition[], id: string | null): EnvDefinition | null {
  if (!id) return null;
  return envs.find((env) => env.id === id) ?? null;
}

/** Libellé d'un env, même inconnu de la déclaration (un workflow peut en porter un ancien). */
export function envLabel(envs: readonly EnvDefinition[], id: string | null): string {
  if (!id) return '';
  return findEnv(envs, id)?.label ?? id.toUpperCase();
}

export function envTagColor(envs: readonly EnvDefinition[], id: string | null): string {
  return findEnv(envs, id)?.color ?? 'default';
}

/**
 * L'id d'un environnement DÉCLARÉ (cf. `domain/env.ts`) : « dev » et « prod » sont
 * les deux bouts obligatoires, le reste s'ajoute depuis les réglages. Un simple
 * `string`, donc — figer l'union interdisait l'env qu'une équipe voudrait en plus.
 */
export type EnvName = string;
