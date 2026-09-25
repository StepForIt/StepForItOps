/**
 * Intervalle à déclarer côté sonde push Kuma, déduit de la cadence réelle de push :
 * une sonde qui attend un beat plus souvent qu'on n'en envoie alerte en permanence.
 */

/** Cadence de poll par défaut des monitors error-watch (config.intervalSeconds). */
export const DEFAULT_ERROR_WATCH_INTERVAL_SECONDS = 120;
/** Cadence de poll par défaut des checks actifs (config.intervalSeconds). */
export const DEFAULT_ACTIVE_INTERVAL_SECONDS = 300;

/**
 * Marge sur la cadence de push : les crons tournent à la minute et ne déclenchent le check
 * qu'au tick suivant l'échéance, un beat peut donc arriver avec ~1 min de retard (+ durée du check).
 */
const SAFETY_FACTOR = 2;
/** Plancher : en dessous, le moindre à-coup réseau ferait clignoter la sonde. */
const MIN_INTERVAL_SECONDS = 60;

interface MonitorTiming {
  /** error-watch, active : cadence de poll. */
  intervalSeconds?: number;
  /** heartbeat : délai toléré entre deux beats du workflow. */
  graceSeconds?: number;
}

export function probeIntervalSeconds(monitor: { kind: string; config?: unknown }): number {
  const config = (monitor.config ?? {}) as MonitorTiming;
  switch (monitor.kind) {
    case 'error-watch':
      return atLeastMinimum((config.intervalSeconds ?? DEFAULT_ERROR_WATCH_INTERVAL_SECONDS) * SAFETY_FACTOR);
    case 'active':
      return atLeastMinimum((config.intervalSeconds ?? DEFAULT_ACTIVE_INTERVAL_SECONDS) * SAFETY_FACTOR);
    // heartbeat : c'est le workflow lui-même qui pousse, sa cadence nous échappe —
    // seul le délai de tolérance configuré fait foi.
    case 'heartbeat':
      return atLeastMinimum(config.graceSeconds ?? MIN_INTERVAL_SECONDS);
    default:
      return MIN_INTERVAL_SECONDS;
  }
}

function atLeastMinimum(seconds: number): number {
  return Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds));
}
