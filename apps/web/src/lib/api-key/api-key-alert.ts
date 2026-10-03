/** Ce que l'API dit de la clé d'une instance — jamais la clé elle-même. */
export interface ApiKeyHealth {
  apiKeyExpiresAt: string | null;
  apiKeyState: 'ok' | 'soon' | 'expired' | 'unknown';
  apiKeyRejectedAt: string | null;
}

export interface ApiKeyAlert {
  level: 'error' | 'warning';
  reason: 'rejected' | 'expired' | 'soon';
}

/** Rouge si la clé est refusée ou expirée, orange sous J-14. Le refus prime : il est constaté, la date n'est que lue. */
export function apiKeyAlert(health: ApiKeyHealth): ApiKeyAlert | null {
  if (health.apiKeyRejectedAt) return { level: 'error', reason: 'rejected' };
  if (health.apiKeyState === 'expired') return { level: 'error', reason: 'expired' };
  if (health.apiKeyState === 'soon') return { level: 'warning', reason: 'soon' };
  return null;
}
