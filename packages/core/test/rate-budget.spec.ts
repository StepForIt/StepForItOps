import { describe, expect, it } from 'vitest';
import { RateBudget } from '../src/domain/rate-budget';

/** Horloge pilotée : le budget se teste sans jamais attendre. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RateBudget', () => {
  it('laisse passer tant que le plafond n est pas atteint', () => {
    const c = clock();
    const budget = new RateBudget(3, c.now);
    for (let i = 0; i < 3; i++) {
      expect(budget.delayMs()).toBe(0);
      budget.record();
    }
  });

  it('fait attendre jusqu à la sortie du plus ancien appel de la fenêtre', () => {
    const c = clock();
    const budget = new RateBudget(2, c.now);
    budget.record();
    c.advance(10_000);
    budget.record();
    expect(budget.delayMs()).toBe(50_000);
  });

  it('rouvre au fur et à mesure : c est une fenêtre glissante, pas un seau qui se vide d un coup', () => {
    const c = clock();
    const budget = new RateBudget(2, c.now);
    budget.record();
    c.advance(30_000);
    budget.record();
    c.advance(30_001);
    expect(budget.delayMs()).toBe(0);
    budget.record();
    expect(budget.delayMs()).toBe(29_999);
  });

  it('ne freine rien quand la plateforme n impose aucun plafond', () => {
    const budget = new RateBudget(0);
    for (let i = 0; i < 500; i++) budget.record();
    expect(budget.delayMs()).toBe(0);
  });
});
