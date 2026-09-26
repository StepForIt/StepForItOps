import { BRAND } from '../../lib/brand/colors';
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

/** Couleur du niveau, et ordre du filtre : du plus grave au plus bavard. Libellé : `misc.appLogs.levels.<value>`. */
export const LEVELS: Array<{ value: AppLogLevel; color: string }> = [
  { value: 'fatal', color: BRAND.danger },
  { value: 'error', color: BRAND.danger },
  { value: 'warn', color: BRAND.warning },
  { value: 'log', color: BRAND.success },
  { value: 'debug', color: BRAND.marine },
  { value: 'verbose', color: '#08979c' },
];

export const LEVEL_COLORS: Record<AppLogLevel, string> = LEVELS.reduce(
  (map, level) => ({ ...map, [level.value]: level.color }),
  {} as Record<AppLogLevel, string>,
);

/** Ce qu'on regarde après un incident : le bruit de mise au point reste décoché. */
export const DEFAULT_LEVELS: AppLogLevel[] = ['fatal', 'error', 'warn', 'log'];
