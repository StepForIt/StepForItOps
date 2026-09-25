import { describe, expect, it } from 'vitest';
import { isCheckDue } from '../src/domain/check-schedule';

/** Cron à la minute : les ticks tombent à t0, t0+60s, t0+120s… */
const MINUTE = 60_000;

describe('check-schedule', () => {
  it('déclenche un monitor jamais checké', () => {
    expect(isCheckDue(null, 120, 0)).toBe(true);
    expect(isCheckDue(undefined, 120, 0)).toBe(true);
  });

  it('déclenche au tick attendu malgré la durée du check', () => {
    // Le check précédent a démarré au tick et a duré 300 ms : lastCheckAt = tick + 300 ms.
    const lastCheckAt = new Date(300);
    expect(isCheckDue(lastCheckAt, 120, 1 * MINUTE)).toBe(false);
    // Sans tolérance, ce tick-ci serait sauté (119,7 s < 120 s) et la cadence passerait à 3 min.
    expect(isCheckDue(lastCheckAt, 120, 2 * MINUTE)).toBe(true);
  });

  it('ne déclenche pas deux checks dans la même minute', () => {
    const lastCheckAt = new Date(300);
    expect(isCheckDue(lastCheckAt, 120, 1 * MINUTE)).toBe(false);
  });

  it('respecte la cadence des checks actifs (5 min)', () => {
    const lastCheckAt = new Date(300);
    expect(isCheckDue(lastCheckAt, 300, 4 * MINUTE)).toBe(false);
    expect(isCheckDue(lastCheckAt, 300, 5 * MINUTE)).toBe(true);
  });

  it('tolère un intervalle plus court que la tolérance sans devenir négatif', () => {
    const lastCheckAt = new Date(0);
    expect(isCheckDue(lastCheckAt, 10, 0)).toBe(true);
  });
});
