/**
 * Échéance d'une clé API d'instance, lue dans la clé elle-même.
 *
 * Les clés récentes de l'API publique n8n sont des JWT dont `exp` est facultatif ;
 * les anciennes (`n8n_api_…`) sont opaques. On décode sans vérifier la signature :
 * on ne s'authentifie pas avec, on lit seulement une date. Sans date lisible, l'état
 * est `unknown` et jamais `ok` — une clé qu'on ne sait pas dater peut très bien
 * mourir demain.
 */

export type ApiKeyExpiryState = 'ok' | 'soon' | 'expired' | 'unknown';

/** Paliers d'alerte, du moins au plus grave. */
export type ApiKeyTier = 'J-14' | 'J-3' | 'expired';

export interface ApiKeyExpiry {
  expiresAt: Date | null;
  state: ApiKeyExpiryState;
}

const DAY_MS = 24 * 3600 * 1000;
const TIER_RANK: Record<ApiKeyTier, number> = { 'J-14': 1, 'J-3': 2, expired: 3 };

export function apiKeyExpiry(key: string, now: Date): ApiKeyExpiry {
  const expiresAt = jwtExpiresAt(key);
  return { expiresAt, state: apiKeyExpiryState(expiresAt, now) };
}

/** Date `exp` d'un JWT, ou null (clé opaque, JWT illisible ou sans `exp`). */
export function jwtExpiresAt(key: string): Date | null {
  const parts = key.trim().split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Même lecture depuis une date déjà stockée : la clé, elle, ne ressort pas de la base. */
export function apiKeyExpiryState(expiresAt: Date | null, now: Date): ApiKeyExpiryState {
  if (expiresAt === null) return 'unknown';
  const tier = apiKeyTier(expiresAt, now);
  if (tier === 'expired') return 'expired';
  return tier ? 'soon' : 'ok';
}

export function apiKeyTier(expiresAt: Date | null, now: Date): ApiKeyTier | null {
  if (!expiresAt) return null;
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 'expired';
  if (remaining <= 3 * DAY_MS) return 'J-3';
  if (remaining <= 14 * DAY_MS) return 'J-14';
  return null;
}

/**
 * Le palier à annoncer, ou null. Seul un palier PLUS GRAVE que le dernier annoncé
 * part : deux passes du cron n'alertent qu'une fois, et une clé déjà expirée au
 * premier passage donne une alerte « expirée », pas la série J-14, J-3, expirée.
 */
export function apiKeyTierToAlert(
  current: ApiKeyTier | null,
  lastAlerted: ApiKeyTier | null,
): ApiKeyTier | null {
  if (!current) return null;
  if (lastAlerted && TIER_RANK[current] <= TIER_RANK[lastAlerted]) return null;
  return current;
}

export function isApiKeyTier(value: unknown): value is ApiKeyTier {
  return typeof value === 'string' && value in TIER_RANK;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}

/**
 * La plateforme refuse la clé (401) ou le compte (403). Lu sur `status` et non par
 * `instanceof` : l'erreur vient d'un adapter, n8n ou Make.
 */
export function isApiKeyRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return status === 401 || status === 403;
}
