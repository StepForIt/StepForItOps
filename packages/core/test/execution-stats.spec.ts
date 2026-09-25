import { describe, expect, it } from 'vitest';
import {
  detectDrift,
  executionDurationMs,
  percentile,
  summarizeDurations,
} from '../src/domain/execution-stats';

describe('executionDurationMs', () => {
  it('calcule la durée entre deux horodatages', () => {
    expect(executionDurationMs('2026-08-19T10:00:00.000Z', '2026-08-19T10:00:02.500Z')).toBe(2500);
  });

  it('renvoie null quand l’exécution n’est pas finie ou est incohérente', () => {
    expect(executionDurationMs('2026-08-19T10:00:00Z', null)).toBeNull();
    expect(executionDurationMs(null, '2026-08-19T10:00:00Z')).toBeNull();
    // stoppedAt avant startedAt : horloge cassée, pas une durée négative.
    expect(executionDurationMs('2026-08-19T10:00:10Z', '2026-08-19T10:00:00Z')).toBeNull();
  });
});

describe('percentile', () => {
  it('interpole entre deux valeurs', () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(250);
    expect(percentile([100, 200, 300], 50)).toBe(200);
  });

  it('renvoie null sur un tableau vide — jamais 0', () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summarizeDurations', () => {
  it('résume médiane, P95 et max', () => {
    const summary = summarizeDurations([500, 100, 300, 200, 400]);
    expect(summary.count).toBe(5);
    expect(summary.p50).toBe(300);
    expect(summary.max).toBe(500);
  });

  it('reste muet sans échantillon', () => {
    expect(summarizeDurations([])).toEqual({ count: 0, p50: null, p95: null, max: null });
  });
});

describe('detectDrift', () => {
  const around = (value: number, count: number) => Array.from({ length: count }, () => value);

  it('détecte une médiane qui double', () => {
    const result = detectDrift(around(2000, 10), around(4500, 10));
    expect(result.drifted).toBe(true);
    expect(result.ratio).toBeCloseTo(2.25);
  });

  it('ne conclut rien sur trop peu d’échantillons', () => {
    expect(detectDrift(around(2000, 3), around(9000, 3)).drifted).toBe(false);
  });

  it('ignore les workflows rapides (plancher de durée)', () => {
    // 80 ms → 400 ms : ratio 5, mais toujours imperceptible.
    expect(detectDrift(around(80, 10), around(400, 10)).drifted).toBe(false);
  });

  it('résiste à une exécution aberrante (médiane, pas moyenne)', () => {
    const recent = [...around(2000, 9), 120000];
    expect(detectDrift(around(2000, 10), recent).drifted).toBe(false);
  });

  it('reste muet quand un côté n’a rien', () => {
    expect(detectDrift([], around(2000, 10))).toEqual({ ratio: null, drifted: false });
  });
});
