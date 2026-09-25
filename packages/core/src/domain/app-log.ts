/**
 * Les logs de la plateforme elle-même, tels qu'un écran peut les rendre.
 *
 * Jusqu'ici ces lignes n'existaient que sur la sortie du conteneur : les lire
 * demandait un accès SSH et un `docker compose logs`, c'est-à-dire exactement ce
 * dont on ne dispose pas quand on regarde la console depuis un téléphone. Le
 * modèle est volontairement plat — un niveau, un contexte, un message, une pile
 * — parce que c'est tout ce que Nest sait d'une ligne de log.
 *
 * Ce fichier ne garde rien : il DÉCRIT et il FILTRE. Le tampon qui retient les
 * lignes vit côté api (`infra/logging`), et lui seul sait combien il en garde.
 */

/** Niveaux de Nest, du plus grave au plus bavard. */
export const APP_LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

export interface AppLogEntry {
  /**
   * Rang d'arrivée dans le process. Identité de la ligne — deux lignes peuvent
   * partager l'horodatage à la milliseconde près, jamais le rang — et curseur du
   * rafraîchissement : l'écran redemande « ce qui suit 1 482 » plutôt que tout.
   */
  seq: number;
  at: string;
  level: AppLogLevel;
  /** Le `[HTTP]`, `[HttpException]`… posé par `new Logger('…')`. */
  context: string;
  message: string;
  /** Pile d'appel, quand la ligne en portait une (erreurs). */
  stack?: string;
}

export interface AppLogQuery {
  /** Niveaux retenus ; vide ou absent ⇒ tous. */
  levels?: AppLogLevel[];
  /** Contexte exact (celui affiché entre crochets). */
  context?: string;
  /** Sous-chaîne cherchée dans le message, la pile et le contexte, insensible à la casse. */
  search?: string;
  /** Rafraîchissement : seulement ce qui est arrivé APRÈS ce rang. */
  sinceSeq?: number;
  /** Nombre de lignes rendues, prises à la FIN : on lit un journal par sa queue. */
  limit?: number;
}

function matchesSearch(entry: AppLogEntry, needle: string): boolean {
  return (
    entry.message.toLowerCase().includes(needle) ||
    entry.context.toLowerCase().includes(needle) ||
    (entry.stack?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * Les lignes retenues par la requête, dans l'ordre d'arrivée.
 *
 * `limit` s'applique en DERNIER, et par la fin : filtrer après avoir tronqué
 * rendrait « les 200 premières lignes qui sont des erreurs » — soit, sur un
 * tampon qui tourne, une fenêtre figée sur le passé pendant que le présent défile.
 */
export function filterAppLogs(entries: AppLogEntry[], query: AppLogQuery = {}): AppLogEntry[] {
  const levels = query.levels?.length ? new Set(query.levels) : null;
  const needle = query.search?.trim().toLowerCase();

  const kept = entries.filter((entry) => {
    if (query.sinceSeq !== undefined && entry.seq <= query.sinceSeq) return false;
    if (levels && !levels.has(entry.level)) return false;
    if (query.context && entry.context !== query.context) return false;
    if (needle && !matchesSearch(entry, needle)) return false;
    return true;
  });

  const limit = query.limit;
  return limit !== undefined && limit >= 0 && kept.length > limit ? kept.slice(-limit) : kept;
}

/** Une ligne de log telle qu'on la colle dans un ticket : même forme que la sortie du conteneur. */
export function formatAppLogLine(entry: AppLogEntry): string {
  const head = `${entry.at} ${entry.level.toUpperCase().padStart(7, ' ')} [${entry.context}] ${entry.message}`;
  return entry.stack ? `${head}\n${entry.stack}` : head;
}

export function formatAppLogText(entries: AppLogEntry[]): string {
  return entries.map(formatAppLogLine).join('\n');
}
