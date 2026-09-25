import { N8nApiError, N8nInstanceConfig } from '@nwm/core';

/**
 * Session navigateur n8n, pour ce que l'API publique ne sert pas.
 *
 * `/types/nodes.json`, `/types/node-versions.json` et `/types/credentials.json`
 * décrivent les nœuds de l'instance — leur version exacte, les nœuds
 * communautaires qui y sont installés. n8n les protège délibérément
 * (`server.ts` : « Protect type files with authentication regardless of UI
 * availability ») derrière `createAuthMiddleware`, qui ne lit QUE le cookie
 * `n8n-auth`. La clé API `X-N8N-API-KEY` n'y donne aucun droit.
 *
 * On ouvre donc une vraie session, avec un compte n8n. Deux précautions :
 *
 * - Le cookie est CONSERVÉ tant qu'il fonctionne. `POST /rest/login` est limité à
 *   5 tentatives par minute et par email côté n8n : une synchro qui se
 *   reconnecterait à chaque appel se ferait jeter, et emporterait avec elle les
 *   connexions de l'humain qui partage ce compte.
 * - Aucun en-tête `browser-id` n'est envoyé. n8n lie le jeton au navigateur
 *   quand il en reçoit un (`validateBrowserId`) ; ne rien envoyer produit un
 *   jeton non lié, utilisable par le seul appelant qui le détient — nous.
 */

const AUTH_COOKIE = 'n8n-auth';

/** Marge avant expiration : on renouvelle plutôt que de risquer un 401 en pleine synchro. */
const SESSION_TTL_MS = 60 * 60 * 1000;

interface Session {
  cookie: string;
  at: number;
}

/** Une session par (instance, compte) : deux instances ne partagent jamais un cookie. */
const sessions = new Map<string, Session>();

function sessionKey(instance: N8nInstanceConfig): string {
  return `${instance.baseUrl}|${instance.login?.email ?? ''}`;
}

function base(instance: N8nInstanceConfig): string {
  return instance.baseUrl.replace(/\/$/, '');
}

/**
 * Extrait le cookie d'auth d'une réponse de login. `getSetCookie` rend les
 * en-têtes un par un : n8n en pose plusieurs, et un simple `get('set-cookie')`
 * les concatènerait en une chaîne où le découpage sur la virgule casse les dates.
 */
function readAuthCookie(response: Response): string | undefined {
  const headers =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  for (const header of headers) {
    const match = /(?:^|;\s*)n8n-auth=([^;]+)/.exec(header);
    if (match) return match[1];
  }
  return undefined;
}

async function login(instance: N8nInstanceConfig): Promise<string> {
  const credentials = instance.login;
  if (!credentials?.email || !credentials.password) {
    throw new N8nApiError(
      `L'instance « ${instance.baseUrl} » n'a pas de compte n8n enregistré. ` +
        `La description des types de nœuds n'est pas servie par l'API publique : ` +
        `renseigne un compte dans la fiche de l'instance, ou reste sur le catalogue mutualisé.`,
      401,
    );
  }

  const response = await fetch(`${base(instance)}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `emailOrLdapLoginId` et non `email` : c'est le nom qu'attend le DTO n8n
    // depuis l'arrivée de LDAP, et un `email` seul se fait refuser en 400.
    body: JSON.stringify({ emailOrLdapLoginId: credentials.email, password: credentials.password }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // 401 : mauvais compte. 429 : on a cogné trop vite — le dire tel quel, sinon
    // l'utilisateur corrige un mot de passe qui n'a jamais été en cause.
    const hint = response.status === 429 ? ' (n8n limite les connexions à 5 par minute et par compte)' : '';
    throw new N8nApiError(
      `Connexion n8n refusée pour « ${credentials.email} » → ${response.status}${hint}: ${text.slice(0, 300)}`,
      response.status,
    );
  }

  const cookie = readAuthCookie(response);
  if (!cookie) {
    throw new N8nApiError(
      `Connexion n8n acceptée mais aucun cookie ${AUTH_COOKIE} reçu : ` +
        `un MFA est probablement exigé sur ce compte, et la plateforme ne sait pas le franchir.`,
      401,
    );
  }
  sessions.set(sessionKey(instance), { cookie, at: Date.now() });
  return cookie;
}

async function cookieFor(instance: N8nInstanceConfig): Promise<string> {
  const known = sessions.get(sessionKey(instance));
  if (known && Date.now() - known.at < SESSION_TTL_MS) return known.cookie;
  return login(instance);
}

/**
 * Appel sur un chemin servi hors `/api/v1`, avec la session navigateur.
 * Un 401 est réessayé UNE fois après reconnexion : le cookie a pu être invalidé
 * de l'autre côté (redémarrage de n8n, déconnexion de l'humain), et re-tenter
 * indéfiniment ferait tomber la limite de connexions.
 */
async function n8nSessionRequest<T>(
  instance: N8nInstanceConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const url = `${base(instance)}${path}`;
  let cookie = await cookieFor(instance);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Cookie: `${AUTH_COOKIE}=${cookie}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status === 401 && attempt === 0) {
      sessions.delete(sessionKey(instance));
      cookie = await login(instance);
      continue;
    }
    const text = await response.text().catch(() => '');
    throw new N8nApiError(
      `n8n ${init.method} ${path} → ${response.status}: ${text.slice(0, 300)}`,
      response.status,
    );
  }
  throw new N8nApiError(`n8n ${init.method} ${path} : session impossible à établir`, 401);
}

export async function n8nSessionGet<T>(instance: N8nInstanceConfig, path: string): Promise<T> {
  return n8nSessionRequest<T>(instance, path, { method: 'GET' });
}

/**
 * POST sur un chemin `/rest`. Ces réponses-là sont ENVELOPPÉES (`{ data: … }`)
 * par n8n, quand les fichiers `/types/*.json` sont servis nus : le
 * déballage est fait ici, une fois, plutôt que dans chaque appelant.
 */
export async function n8nSessionPost<T>(
  instance: N8nInstanceConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const payload = await n8nSessionRequest<unknown>(instance, path, { method: 'POST', body });
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/** Oublie la session d'une instance (changement de compte, test de connexion). */
export function forgetN8nSession(instance: N8nInstanceConfig): void {
  sessions.delete(sessionKey(instance));
}
