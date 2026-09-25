import { describe, expect, it } from 'vitest';
import { captureGesture } from '../src/domain/release-macro';
import {
  frozenCount,
  hopStep,
  insertPosition,
  manualGesture,
  reorderSteps,
} from '../src/domain/release-macro-edit';

const ENVS = ['dev', 'preprod', 'prod'];

describe('frozenCount', () => {
  it('fige les étapes jouées, passées ou en cours, en tête', () => {
    expect(frozenCount(['done', 'skipped', 'running', 'todo', 'todo'])).toBe(3);
  });

  it("ne fige rien avant le rejeu, ni l'étape qui attend un humain ou a échoué", () => {
    expect(frozenCount([])).toBe(0);
    expect(frozenCount(['todo', 'todo'])).toBe(0);
    expect(frozenCount(['done', 'waiting', 'todo'])).toBe(1);
    expect(frozenCount(['done', 'failed'])).toBe(1);
  });
});

describe('reorderSteps', () => {
  const current = ['a', 'b', 'c', 'd'];

  it('accepte un nouvel ordre des mêmes étapes', () => {
    expect(reorderSteps(current, ['c', 'a', 'd', 'b'])).toEqual({ ok: true, order: ['c', 'a', 'd', 'b'] });
  });

  it('refuse une liste incomplète, étrangère ou avec un doublon', () => {
    expect(reorderSteps(current, ['a', 'b', 'c']).ok).toBe(false);
    expect(reorderSteps(current, ['a', 'b', 'c', 'x']).ok).toBe(false);
    expect(reorderSteps(current, ['a', 'b', 'c', 'd', 'x']).ok).toBe(false);
    expect(reorderSteps(current, ['a', 'a', 'c', 'd']).ok).toBe(false);
  });

  it("ne touche pas aux étapes figées d'un rejeu", () => {
    expect(reorderSteps(current, ['a', 'b', 'd', 'c'], 2)).toEqual({ ok: true, order: ['a', 'b', 'd', 'c'] });
    const moved = reorderSteps(current, ['a', 'c', 'b', 'd'], 2);
    expect(moved).toEqual({ ok: false, reason: expect.stringContaining('déjà jouées') });
    expect(reorderSteps(current, ['c', 'a', 'b', 'd'], 1).ok).toBe(false);
  });
});

describe('insertPosition', () => {
  it('va à la fin sans position, et reste dans les bornes', () => {
    expect(insertPosition(undefined, 4)).toBe(4);
    expect(insertPosition(2, 4)).toBe(2);
    expect(insertPosition(-3, 4)).toBe(0);
    expect(insertPosition(9, 4)).toBe(4);
  });

  it("ne s'insère jamais avant une étape figée", () => {
    expect(insertPosition(0, 4, 2)).toBe(2);
    expect(insertPosition(3, 4, 2)).toBe(3);
  });
});

describe('manualGesture', () => {
  const base = { familyKey: 'facturation', familyName: 'Facturation' };

  it('produit une étape de la MÊME forme que ce que capte un enregistrement', () => {
    const result = manualGesture(
      {
        ...base,
        action: 'promote',
        sourceEnv: 'dev',
        targetEnv: 'preprod',
        options: { cascade: true, force: true },
      },
      ENVS,
    );
    const captured = captureGesture('POST', '/env-switcher/promote/wf1', {
      targetEnv: 'preprod',
      cascade: true,
      force: true,
    });
    expect(result).toEqual({
      ok: true,
      step: {
        kind: 'auto',
        action: 'promote',
        familyKey: 'facturation',
        familyName: 'Facturation',
        sourceEnv: 'dev',
        targetEnv: 'preprod',
        options: captured?.options,
        label: 'Promouvoir Facturation vers PREPROD',
      },
    });
  });

  it("n'emporte aucune décision tranchée (force, confirmSkip, bump)", () => {
    const result = manualGesture(
      {
        ...base,
        action: 'promote',
        sourceEnv: 'dev',
        targetEnv: 'prod',
        options: { force: true, confirmSkip: true, bump: true, throughChain: false },
      },
      ENVS,
    );
    expect(result.ok && result.step.options).toEqual({ throughChain: false });
  });

  it('joue les tests sur un env, sans env visé', () => {
    const result = manualGesture(
      { ...base, action: 'run-tests', sourceEnv: 'preprod', targetEnv: 'prod' },
      ENVS,
    );
    expect(result.ok && result.step).toMatchObject({
      sourceEnv: 'preprod',
      targetEnv: null,
      label: 'Jouer les tests de Facturation',
    });
    expect(manualGesture({ ...base, action: 'run-tests' }, ENVS).ok).toBe(false);
  });

  it('rebranche un exemplaire sur les données de son propre env', () => {
    const result = manualGesture({ ...base, action: 'switch', sourceEnv: 'prod', targetEnv: 'prod' }, ENVS);
    expect(result.ok && result.step).toMatchObject({
      sourceEnv: 'prod',
      targetEnv: 'prod',
      label: 'Rebrancher Facturation sur PROD',
    });
    expect(manualGesture({ ...base, action: 'switch', targetEnv: 'prod' }, ENVS).ok).toBe(false);
  });

  it('publie un exemplaire, sans env visé', () => {
    const result = manualGesture({ ...base, action: 'publish', sourceEnv: 'prod', targetEnv: 'dev' }, ENVS);
    expect(result.ok && result.step).toMatchObject({
      sourceEnv: 'prod',
      targetEnv: null,
      label: 'Publier Facturation en PROD',
    });
    expect(manualGesture({ ...base, action: 'publish' }, ENVS).ok).toBe(false);
  });

  it("déclare un env sans exiger celui d'où l'on part", () => {
    const result = manualGesture({ ...base, action: 'mark', targetEnv: 'dev' }, ENVS);
    expect(result.ok && result.step).toMatchObject({
      sourceEnv: null,
      targetEnv: 'dev',
      label: 'Déclarer Facturation en DEV',
    });
  });

  it('refuse un geste incomplet ou incohérent', () => {
    const refused = [
      { ...base, action: 'deploy', sourceEnv: 'dev', targetEnv: 'prod' },
      { familyKey: ' ', familyName: 'X', action: 'promote', sourceEnv: 'dev', targetEnv: 'prod' },
      { ...base, action: 'promote', sourceEnv: 'dev' },
      { ...base, action: 'promote', targetEnv: 'prod' },
      { ...base, action: 'duplicate', sourceEnv: 'prod', targetEnv: 'prod' },
      { ...base, action: 'promote', sourceEnv: 'dev', targetEnv: 'qualif' },
      { ...base, action: 'mark', sourceEnv: 'recette', targetEnv: 'dev' },
    ];
    for (const input of refused) expect(manualGesture(input, ENVS).ok, JSON.stringify(input)).toBe(false);
  });
});

describe('hopStep', () => {
  const step = (id: string, action: string | null, sourceEnv: string | null, targetEnv: string | null) => ({
    id,
    action,
    sourceEnv,
    targetEnv,
  });

  it("retient la première promotion ou duplication, dans l'ordre des étapes", () => {
    const steps = [
      step('a', 'mark', 'dev', 'dev'),
      step('b', 'switch', 'preprod', 'preprod'),
      step('c', 'duplicate', 'dev', 'preprod'),
      step('d', 'promote', 'preprod', 'prod'),
    ];
    expect(hopStep(steps)?.id).toBe('c');
  });

  it('ne dit aucun saut sans geste qui fasse exister le workflow ailleurs', () => {
    expect(hopStep([step('a', 'mark', null, 'dev'), step('b', null, null, null)])).toBeNull();
    expect(hopStep([step('a', 'promote', null, 'prod')])).toBeNull();
  });
});
