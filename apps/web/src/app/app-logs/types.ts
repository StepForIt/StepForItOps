/** Miroir du modèle `app-log` de @nwm/core : le web ne dépend pas du domaine. */
export type AppLogLevel = 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';

export interface AppLogEntry {
  seq: number;
  at: string;
  level: AppLogLevel;
  context: string;
  message: string;
  stack?: string;
}

export interface AppLogsResponse {
  entries: AppLogEntry[];
  contexts: string[];
  held: number;
  capacity: number;
  dropped: number;
  lastSeq: number;
}

/** Couleur du niveau, et ordre du filtre : du plus grave au plus bavard. */
export const LEVELS: Array<{ value: AppLogLevel; label: string; color: string }> = [
  { value: 'fatal', label: 'Fatal', color: '#a8071a' },
  { value: 'error', label: 'Erreur', color: '#cf1322' },
  { value: 'warn', label: 'Avert.', color: '#d46b08' },
  { value: 'log', label: 'Info', color: '#389e0d' },
  { value: 'debug', label: 'Debug', color: '#c41d7f' },
  { value: 'verbose', label: 'Verbose', color: '#08979c' },
];

export const LEVEL_COLORS: Record<AppLogLevel, string> = LEVELS.reduce(
  (map, level) => ({ ...map, [level.value]: level.color }),
  {} as Record<AppLogLevel, string>,
);

/** Ce qu'on regarde après un incident : le bruit de mise au point reste décoché. */
export const DEFAULT_LEVELS: AppLogLevel[] = ['fatal', 'error', 'warn', 'log'];
