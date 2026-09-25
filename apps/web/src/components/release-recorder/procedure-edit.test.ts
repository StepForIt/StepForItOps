import { describe, expect, it } from 'vitest';
import { frozenCount, moveStep, nextToPlay, unshiftEnv } from './procedure-edit';
import type { StepRun } from './types';

const runs = (states: Record<string, StepRun['state']>): Record<string, StepRun> =>
  Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state } as StepRun]));

describe('frozenCount', () => {
  it('fige en tête les étapes jouées, passées ou en cours', () => {
    const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(frozenCount(steps, runs({ a: 'done', b: 'skipped', c: 'running' }))).toBe(3);
    expect(frozenCount(steps, runs({ a: 'done', b: 'waiting' }))).toBe(1);
    expect(frozenCount(steps, {})).toBe(0);
  });
});

describe('nextToPlay', () => {
  it("suit l'étape par son id : réordonner derrière le curseur ne fait ni sauter ni rejouer", () => {
    const played = runs({ a: 'done', b: 'done' });
    expect(nextToPlay([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], played)?.id).toBe('c');
    // `d` remonté juste après la zone figée : c'est lui qui part, `a` et `b` ne rejouent pas.
    expect(nextToPlay([{ id: 'a' }, { id: 'b' }, { id: 'd' }, { id: 'c' }], played)?.id).toBe('d');
    // `c` supprimé : on enchaîne sur `d`.
    expect(nextToPlay([{ id: 'a' }, { id: 'b' }, { id: 'd' }], played)?.id).toBe('d');
  });

  it('ignore une étape jouée restée derrière une autre (glisser parti pendant qu’elle se jouait)', () => {
    // La zone figée envoyée au clic valait 1 ; `b` a fini entre-temps, puis `d` est passé devant lui.
    const steps = [{ id: 'a' }, { id: 'd' }, { id: 'b' }, { id: 'c' }];
    expect(nextToPlay(steps, runs({ a: 'done', b: 'done' }))?.id).toBe('d');
  });

  it('ne rend rien quand tout est joué', () => {
    expect(nextToPlay([{ id: 'a' }], runs({ a: 'skipped' }))).toBeNull();
  });
});

describe('moveStep', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it("déplace une étape d'un cran ou d'un glisser", () => {
    expect(moveStep(ids, 'c', 1)).toEqual(['a', 'b', 'd', 'c']);
    expect(moveStep(ids, 'c', -2)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ne sort pas de la liste et ne franchit pas la zone figée', () => {
    expect(moveStep(ids, 'd', 1)).toBeNull();
    expect(moveStep(ids, 'c', -1, 2)).toBeNull();
    expect(moveStep(ids, 'a', 1, 2)).toBeNull();
    expect(moveStep(ids, 'd', -1, 2)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('unshiftEnv', () => {
  const recorded = { source: 'dev', target: 'preprod' };
  const replay = { source: 'preprod', target: 'prod' };
  const all = ['dev', 'preprod', 'prod', 'recette'];

  it("ramène l'env lu au rejeu à celui de l'enregistrement", () => {
    expect(unshiftEnv('prod', null, all, recorded, replay)).toBe('preprod');
    expect(unshiftEnv('preprod', null, all, recorded, replay)).toBe('dev');
    expect(unshiftEnv('recette', null, all, recorded, replay)).toBe('recette');
  });

  it("dit quand un env ne s'écrit pas dans les termes de l'enregistrement", () => {
    // `dev` enregistré se rejoue `preprod` : aucun env enregistré ne se rejoue `dev`.
    expect(unshiftEnv('dev', null, all, recorded, replay)).toBeNull();
    // …sauf une déclaration sur l'env de départ, qui ne se décale pas.
    expect(unshiftEnv('dev', 'mark', all, recorded, replay)).toBe('dev');
  });

  it("rend l'env tel quel hors rejeu", () => {
    expect(unshiftEnv('dev', null, all, recorded, null)).toBe('dev');
  });
});
