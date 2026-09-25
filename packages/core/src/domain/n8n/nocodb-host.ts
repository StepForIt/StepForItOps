/**
 * Retrouver l'URL d'une instance NocoDB : elle vit dans le credential, que
 * l'API n8n ne rend jamais. Mais un nœud HTTP Request qui appelle la même base
 * porte son URL en clair — si elle contient un id de table ou de base déjà vu
 * sur un nœud NocoDB, son origine est l'instance cherchée. On ne devine rien,
 * on recoupe deux endroits du même JSON.
 */

/** Une URL appelée en HTTP, avec de quoi dire à l'utilisateur d'où elle sort. */
export interface CalledUrl {
  url: string;
  workflowName?: string;
  nodeName?: string;
}

/** Une instance NocoDB probable, avec sa preuve. */
export interface NocoDbHostHint {
  /** Origine seule, sans slash final : `https://app.nocodb.com`. */
  host: string;
  /** L'id (table ou base) qui a fait le lien. */
  matchedId: string;
  sourceUrl: string;
  workflowName?: string;
  nodeName?: string;
}

/** Chemins d'API qui identifient NocoDB — v2 (méta et données) comme v1. */
const NOCODB_PATHS = ['/api/v2/', '/api/v1/db/'];

/**
 * Instance cloud NocoDB : les bases y vivent sous un workspace (inexistant en
 * auto-hébergé) et `/api/v2/meta/bases` y répond 403 — il faut passer par
 * `/api/v2/meta/workspaces/<id>/bases`.
 */
export function isNocoDbCloud(host: string): boolean {
  const hostname = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();
  return hostname === 'nocodb.com' || hostname.endsWith('.nocodb.com');
}

/** Origine d'une URL, y compris quand la fin est une expression n8n. */
function originOf(url: string): string | undefined {
  let literal = url.startsWith('=') ? url.slice(1) : url;
  if (literal.includes('{{')) literal = literal.slice(0, literal.indexOf('{{'));
  try {
    const { protocol, host } = new URL(literal);
    return host ? `${protocol}//${host}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Instances NocoDB déduites des appels HTTP, pour les ids donnés (bases et tables
 * atteintes par un credential). Une origine n'est retenue qu'une fois, avec le
 * premier appel qui l'a trahie.
 */
export function guessNocoDbHosts(urls: CalledUrl[], ids: string[]): NocoDbHostHint[] {
  const wanted = ids.filter((id) => id.length >= 8);
  const hints = new Map<string, NocoDbHostHint>();

  for (const called of urls) {
    if (!NOCODB_PATHS.some((path) => called.url.includes(path))) continue;
    const matchedId = wanted.find((id) => called.url.includes(id));
    if (!matchedId) continue;
    const host = originOf(called.url);
    if (!host || hints.has(host)) continue;
    hints.set(host, {
      host,
      matchedId,
      sourceUrl: called.url,
      workflowName: called.workflowName,
      nodeName: called.nodeName,
    });
  }
  return [...hints.values()];
}
