import { describe, expect, it } from 'vitest';
import { rebaseSteps, RebasableStep } from '../src/domain/release-macro-rebase';

const recorded = { source: 'dev', target: 'preprod' };
const toProd = { source: 'preprod', target: 'prod' };

function auto(step: Partial<RebasableStep>): RebasableStep {
  return {
    kind: 'auto',
    action: 'promote',
    familyKey: 'facturation',
    familyName: 'Facturation',
    sourceEnv: 'dev',
    targetEnv: 'preprod',
    options: null,
    label: 'Promouvoir Facturation vers PREPROD',
    note: null,
    ...step,
  };
}

describe('rebaseSteps', () => {
  it('décale une promotion comme le rejeu, et en réécrit le libellé', () => {
    const [step] = rebaseSteps([auto({ options: { cascade: true } })], recorded, toProd);
    expect(step).toEqual(
      auto({
        sourceEnv: 'preprod',
        targetEnv: 'prod',
        options: { cascade: true },
        label: 'Promouvoir Facturation vers PROD',
      }),
    );
  });

  it('recopie une étape manuelle telle quelle, à sa place', () => {
    const manual: RebasableStep = {
      kind: 'manual',
      action: null,
      familyKey: null,
      familyName: null,
      sourceEnv: null,
      targetEnv: null,
      options: null,
      label: 'Créer la credential Stripe',
      note: 'Clé live, pas la clé de test',
    };
    const steps = rebaseSteps(
      [auto({}), manual, auto({ action: 'run-tests', targetEnv: null })],
      recorded,
      toProd,
    );
    expect(steps.map((step) => step.label)).toEqual([
      'Promouvoir Facturation vers PROD',
      'Créer la credential Stripe',
      'Jouer les tests de Facturation',
    ]);
    expect(steps[1]).toEqual(manual);
    expect(steps[2]).toMatchObject({ sourceEnv: 'preprod', targetEnv: null });
  });

  it("décale ensemble l'exemplaire rebranché et l'env de ses données", () => {
    const [step] = rebaseSteps(
      [auto({ action: 'switch', sourceEnv: 'preprod', targetEnv: 'preprod' })],
      recorded,
      toProd,
    );
    expect(step).toMatchObject({
      sourceEnv: 'prod',
      targetEnv: 'prod',
      label: 'Rebrancher Facturation sur PROD',
    });
  });

  it("décale l'exemplaire publié, et son env dans le libellé", () => {
    const [step] = rebaseSteps(
      [
        auto({
          action: 'publish',
          sourceEnv: 'preprod',
          targetEnv: null,
          label: 'Publier Facturation en PREPROD',
        }),
      ],
      recorded,
      toProd,
    );
    expect(step).toMatchObject({ sourceEnv: 'prod', targetEnv: null, label: 'Publier Facturation en PROD' });
  });

  it("ne décale pas la déclaration d'un workflow neuf sur l'env de départ", () => {
    const [step] = rebaseSteps(
      [auto({ action: 'mark', sourceEnv: null, targetEnv: 'dev', label: 'Déclarer Facturation en DEV' })],
      recorded,
      toProd,
    );
    expect(step).toMatchObject({ targetEnv: 'dev', label: 'Déclarer Facturation en DEV' });
  });

  it('ne touche pas un env étranger au saut enregistré', () => {
    const [step] = rebaseSteps([auto({ sourceEnv: 'recette', targetEnv: 'recette' })], recorded, toProd);
    expect(step).toMatchObject({ sourceEnv: 'recette', targetEnv: 'recette' });
  });

  it("garde la note d'une étape décalée", () => {
    const [step] = rebaseSteps([auto({ note: 'Prévenir le client avant' })], recorded, toProd);
    expect(step).toMatchObject({ targetEnv: 'prod', note: 'Prévenir le client avant' });
  });
});
