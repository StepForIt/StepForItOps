/**
 * État du premier login (compte créé via /setup), lu auprès de l'API et mis en
 * cache : le middleware passe ici à chaque requête, pas question d'un aller-retour
 * HTTP systématique. En cas d'API muette, on retombe sur la config d'environnement
 * seule — jamais de plateforme verrouillée par une panne du backend.
 */

export interface DbAuthState {
  configured: boolean;
  username: string | null;
  sessionSecret: string | null;
}

const CACHE_TTL_MS = 10_000;

let cached: { at: number; state: DbAuthState | null } = { at: 0, state: null };

function apiBase(): string {
  return process.env.API_INTERNAL_URL || 'http://localhost:3001';
}

export async function dbAuthState(): Promise<DbAuthState | null> {
  if (Date.now() - cached.at < CACHE_TTL_MS) return cached.state;
  try {
    const headers: Record<string, string> = {};
    if (process.env.API_ACCESS_TOKEN) headers['x-api-token'] = process.env.API_ACCESS_TOKEN;
    const response = await fetch(`${apiBase()}/auth-settings/bootstrap`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const state = (await response.json()) as DbAuthState;
    cached = { at: Date.now(), state };
    return state;
  } catch {
    // API injoignable (redémarrage) : on n'écrase pas un état connu par un null.
    if (cached.state) return cached.state;
    cached = { at: Date.now(), state: null };
    return null;
  }
}

/** À appeler après le bootstrap : la prochaine requête relit l'état réel. */
export function invalidateDbAuthCache(): void {
  cached = { at: 0, state: null };
}

export async function verifyDbCredentials(username: string, password: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.API_ACCESS_TOKEN) headers['x-api-token'] = process.env.API_ACCESS_TOKEN;
    const response = await fetch(`${apiBase()}/auth-settings/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
    if (!response.ok) return false;
    return Boolean(((await response.json()) as { ok: boolean }).ok);
  } catch {
    return false;
  }
}

export async function bootstrapDbAuth(
  username: string,
  password: string,
): Promise<{ ok: true; state: DbAuthState } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.API_ACCESS_TOKEN) headers['x-api-token'] = process.env.API_ACCESS_TOKEN;
    const response = await fetch(`${apiBase()}/auth-settings/bootstrap`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
    const body = (await response.json()) as DbAuthState & { message?: string };
    if (!response.ok) return { ok: false, error: body.message ?? `Erreur ${response.status}` };
    invalidateDbAuthCache();
    return { ok: true, state: body };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
