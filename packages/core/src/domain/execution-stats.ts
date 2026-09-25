/**
 * Statistiques de durée d'exécution (pures, sans IO). La question n'est pas
 * « combien de temps en moyenne » mais « est-ce que ça a changé » — d'où
 * médiane et P95 plutôt que moyenne : une exécution aberrante ne doit pas
 * crier à la dérive.
 */

export interface DurationSummary {
  count: number;
  /** Médiane, en ms — null sans échantillon. */
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface DriftOptions {
  /** En dessous de ce nombre d'exécutions de chaque côté, on ne conclut rien. */
  minSamples?: number;
  /** Facteur de médiane à partir duquel on parle de dérive (2 = deux fois plus lent). */
  factor?: number;
  /** Dérive ignorée sous ce plancher : passer de 80 ms à 200 ms n'intéresse personne. */
  minMedianMs?: number;
}

export interface DriftResult {
  /** médiane récente / médiane de référence — null si l'un des deux côtés est muet. */
  ratio: number | null;
  drifted: boolean;
}

const DEFAULT_MIN_SAMPLES = 5;
const DEFAULT_FACTOR = 2;
const DEFAULT_MIN_MEDIAN_MS = 1000;

/** Durée d'une exécution, en ms — null si elle n'est pas finie ou incohérente. */
export function executionDurationMs(
  startedAt: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined,
): number | null {
  if (!startedAt || !stoppedAt) return null;
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(stop) || stop < start) return null;
  return stop - start;
}

/**
 * Percentile par interpolation linéaire sur un tableau TRIÉ croissant.
 * null sur un tableau vide — jamais 0, qui serait une vraie valeur.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedAsc[low];
  return sortedAsc[low] + (sortedAsc[high] - sortedAsc[low]) * (rank - low);
}

export function summarizeDurations(durations: number[]): DurationSummary {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}

/**
 * Dérive de durée : la médiane récente contre celle d'une période de référence.
 * Volontairement conservateur (médianes, plancher d'échantillons et de durée) :
 * une fausse alerte de dérive apprend à ignorer la vraie.
 */
export function detectDrift(baseline: number[], recent: number[], options: DriftOptions = {}): DriftResult {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const minMedianMs = options.minMedianMs ?? DEFAULT_MIN_MEDIAN_MS;

  const baseMedian = percentile(
    [...baseline].sort((a, b) => a - b),
    50,
  );
  const recentMedian = percentile(
    [...recent].sort((a, b) => a - b),
    50,
  );
  if (baseMedian === null || recentMedian === null || baseMedian === 0) {
    return { ratio: null, drifted: false };
  }
  const ratio = recentMedian / baseMedian;
  const drifted =
    baseline.length >= minSamples &&
    recent.length >= minSamples &&
    recentMedian >= minMedianMs &&
    ratio >= factor;
  return { ratio, drifted };
}
