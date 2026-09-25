import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVS } from '../src/domain/env';
import { captureGesture, nextHop, replayEnv, replayTargetEnv, stepLabel } from '../src/domain/release-macro';

describe('captureGesture', () => {
  it('capte une promotion appliquée, avec ses options', () => {
    expect(
      captureGesture('POST', '/env-switcher/promote/w1', {
        targetInstanceId: 'i-prod',
        targetEnv: 'preprod',
        cascade: true,
        throughChain: false,
        checkRemote: true,
        force: true,
        bump: 'minor',
      }),
    ).toEqual({
      action: 'promote',
      workflowId: 'w1',
      targetEnv: 'preprod',
      options: { cascade: true, throughChain: false, checkRemote: true },
    });
  });

  it("ne rejoue jamais une décision humaine : ni force, ni bump, ni l'instance cible", () => {
    const captured = captureGesture('POST', '/env-switcher/promote/w1', {
      targetEnv: 'prod',
      force: true,
      confirmSkip: true,
      bump: 'major',
      targetInstanceId: 'i-prod',
    });
    expect(captured?.options).toEqual({});
  });

  it("ignore l'aperçu d'une promotion, qui n'écrit rien", () => {
    expect(captureGesture('POST', '/env-switcher/promote/w1/preview', { targetEnv: 'prod' })).toBeNull();
  });

  it("capte une déclaration d'env et une duplication", () => {
    expect(captureGesture('POST', '/env-switcher/mark/w2', { targetEnv: 'dev', rename: true })).toEqual({
      action: 'mark',
      workflowId: 'w2',
      targetEnv: 'dev',
      options: { rename: true },
    });
    expect(
      captureGesture('POST', '/env-switcher/duplicate/w3', { targetEnv: 'preprod', cascade: true }),
    ).toEqual({ action: 'duplicate', workflowId: 'w3', targetEnv: 'preprod', options: { cascade: true } });
  });

  it('capte le rejeu des cas de test, sans env cible', () => {
    expect(captureGesture('POST', '/tester/cases/run-all/w4', undefined)).toEqual({
      action: 'run-tests',
      workflowId: 'w4',
      targetEnv: null,
      options: {},
    });
  });

  it('capte un rebranchement des ressources, pas son aperçu', () => {
    expect(captureGesture('POST', '/env-switcher/apply/w6', { targetEnv: 'prod' })).toEqual({
      action: 'switch',
      workflowId: 'w6',
      targetEnv: 'prod',
      options: {},
    });
    expect(captureGesture('POST', '/env-switcher/preview/w6', { targetEnv: 'prod' })).toBeNull();
  });

  it("capte la publication d'un workflow, sans env cible", () => {
    expect(captureGesture('POST', '/workflows/w5/publish', undefined)).toEqual({
      action: 'publish',
      workflowId: 'w5',
      targetEnv: null,
      options: {},
    });
    expect(captureGesture('POST', '/workflows/w5/archive', undefined)).toBeNull();
  });

  it("ignore les lectures, les gestes inconnus et ceux d'une promotion sans env cible", () => {
    expect(captureGesture('GET', '/env-switcher/promote/w1', undefined)).toBeNull();
    expect(captureGesture('POST', '/workflows/w1/sync', undefined)).toBeNull();
    expect(captureGesture('POST', '/env-switcher/promote/w1', {})).toBeNull();
  });

  it('ignore la chaîne de requête', () => {
    expect(captureGesture('POST', '/tester/cases/run-all/w4?x=1', undefined)?.workflowId).toBe('w4');
  });
});

describe('replayEnv', () => {
  const recorded = { source: 'dev', target: 'preprod' };
  const replay = { source: 'preprod', target: 'prod' };

  it('décale la source et la cible enregistrées', () => {
    expect(replayEnv('dev', recorded, replay)).toBe('preprod');
    expect(replayEnv('preprod', recorded, replay)).toBe('prod');
  });

  it("laisse tel quel un env qui n'était ni la source ni la cible", () => {
    expect(replayEnv('recette', recorded, replay)).toBe('recette');
    expect(replayEnv(null, recorded, replay)).toBeNull();
  });
});

describe('replayTargetEnv', () => {
  const recorded = { source: 'dev', target: 'preprod' };
  const replay = { source: 'preprod', target: 'prod' };

  it("ne décale pas une déclaration sur l'env de départ : c'est une préparation, pas une étape du saut", () => {
    expect(replayTargetEnv('mark', 'dev', recorded, replay)).toBe('dev');
  });

  it("décale une déclaration sur l'env d'arrivée, comme n'importe quel geste", () => {
    expect(replayTargetEnv('mark', 'preprod', recorded, replay)).toBe('prod');
    expect(replayTargetEnv('promote', 'preprod', recorded, replay)).toBe('prod');
  });
});

describe('nextHop', () => {
  it("propose l'env qui dépend de celui-ci", () => {
    expect(nextHop(DEFAULT_ENVS, 'preprod')).toBe('prod');
    expect(nextHop(DEFAULT_ENVS, 'dev')).toBe('preprod');
  });

  it('ne propose rien au bout de la chaîne ou pour un env inconnu', () => {
    expect(nextHop(DEFAULT_ENVS, 'prod')).toBeNull();
    expect(nextHop(DEFAULT_ENVS, 'nope')).toBeNull();
  });
});

describe('stepLabel', () => {
  it('nomme le geste, le workflow métier et la cible', () => {
    expect(stepLabel({ action: 'promote', familyName: 'Facturation', targetEnv: 'prod' })).toBe(
      'Promouvoir Facturation vers PROD',
    );
    expect(stepLabel({ action: 'run-tests', familyName: 'Facturation', targetEnv: null })).toBe(
      'Jouer les tests de Facturation',
    );
  });

  it('branche un rebranchement « sur » son env', () => {
    expect(stepLabel({ action: 'switch', familyName: 'Facturation', targetEnv: 'prod' })).toBe(
      'Rebrancher Facturation sur PROD',
    );
  });

  it("nomme l'env publié, qui est celui de l'exemplaire", () => {
    expect(
      stepLabel({ action: 'publish', familyName: 'Facturation', targetEnv: null, sourceEnv: 'prod' }),
    ).toBe('Publier Facturation en PROD');
  });
});
