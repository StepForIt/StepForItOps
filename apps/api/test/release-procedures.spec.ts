import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENVS } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { ReleaseProceduresService } from '../src/modules/release-procedures/release-procedures.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * L'enregistreur de procédures : ce que la console fait pendant qu'il tourne
 * devient une liste d'étapes, rangée par workflow métier et par env pour être
 * rejouée un cran plus loin dans la chaîne.
 */

const prisma = testPrisma() as unknown as PrismaService;

const settings = {
  async declaredEnvs() {
    return DEFAULT_ENVS;
  },
  async declaredEnvIds() {
    return DEFAULT_ENVS.map((env) => env.id);
  },
} as unknown as PlatformSettingsService;

const service = new ReleaseProceduresService(prisma, settings);
const ME = 'moi@stepforit.fr';

let seq = 0;

async function workflow(name: string, extra: { archivedUpstream?: boolean; tags?: string[] } = {}) {
  const instance =
    (await prisma.instance.findFirst()) ??
    (await prisma.instance.create({ data: { name: 'Atelier', baseUrl: 'http://atelier', apiKey: 'k' } }));
  return prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: `w${++seq}`,
      name,
      active: false,
      tags: [],
      hash: 'h',
      raw: {},
      ...extra,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ReleaseProceduresService', () => {
  it('range une promotion captée par workflow métier et par env, et retient le saut enregistré', async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release septembre', ME);

    const result = await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/promote/${dev.id}`,
      body: { targetEnv: 'preprod', cascade: true, force: true },
    });

    expect(result.captured).toBe(true);
    const saved = await service.get(procedure.id);
    expect(saved).toMatchObject({ sourceEnv: 'dev', targetEnv: 'preprod', status: 'recording' });
    expect(saved.steps).toEqual([
      expect.objectContaining({
        kind: 'auto',
        action: 'promote',
        familyKey: 'facturation',
        familyName: 'Facturation',
        sourceEnv: 'dev',
        targetEnv: 'preprod',
        options: { cascade: true },
        label: 'Promouvoir Facturation vers PREPROD',
      }),
    ]);
  });

  it("n'enregistre rien hors enregistrement, ni un geste qui ne se rejoue pas", async () => {
    const dev = await workflow('Facturation - DEV');
    const path = `/env-switcher/promote/${dev.id}`;
    expect(
      (await service.capture(ME, { method: 'POST', path, body: { targetEnv: 'preprod' } })).captured,
    ).toBe(false);

    const procedure = await service.start('Release', ME);
    await service.capture(ME, { method: 'POST', path: `${path}/preview`, body: { targetEnv: 'preprod' } });
    await service.capture('autre@stepforit.fr', { method: 'POST', path, body: { targetEnv: 'preprod' } });
    expect((await service.get(procedure.id)).steps).toEqual([]);
  });

  it("range un rebranchement sur l'exemplaire, sans en faire le saut de la procédure", async () => {
    const preprod = await workflow('Facturation - PREPROD');
    const procedure = await service.start('Release', ME);
    await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/apply/${preprod.id}`,
      body: { targetEnv: 'preprod' },
    });

    const saved = await service.get(procedure.id);
    expect(saved).toMatchObject({ sourceEnv: null, targetEnv: null });
    expect(saved.steps).toEqual([
      expect.objectContaining({
        action: 'switch',
        sourceEnv: 'preprod',
        targetEnv: 'preprod',
        label: 'Rebrancher Facturation sur PREPROD',
      }),
    ]);
  });

  it("insère une étape manuelle là où on l'a demandée", async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release', ME);
    const path = `/env-switcher/promote/${dev.id}`;
    await service.capture(ME, { method: 'POST', path, body: { targetEnv: 'preprod' } });
    await service.capture(ME, { method: 'POST', path: `/tester/cases/run-all/${dev.id}` });
    await service.addManual(procedure.id, { label: 'Créer la colonne Pénalité', position: 1 });

    const labels = (await service.get(procedure.id)).steps.map((step) => step.label);
    expect(labels).toEqual([
      'Promouvoir Facturation vers PREPROD',
      'Créer la colonne Pénalité',
      'Jouer les tests de Facturation',
    ]);
  });

  it('duplique une procédure vers le saut suivant : envs décalés, manuelles recopiées, originale intacte', async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release', ME);
    await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/promote/${dev.id}`,
      body: { targetEnv: 'preprod', cascade: true },
    });
    await service.addManual(procedure.id, { label: 'Créer la credential Stripe' });
    await service.stop(procedure.id);

    const copy = await service.duplicate(
      procedure.id,
      { sourceEnv: 'preprod', targetEnv: 'prod' },
      'autre@x.fr',
    );

    expect(copy).toMatchObject({
      name: 'Release (PREPROD → PROD)',
      status: 'ready',
      recordedBy: 'autre@x.fr',
      sourceEnv: 'preprod',
      targetEnv: 'prod',
    });
    expect(copy.steps).toEqual([
      expect.objectContaining({
        position: 0,
        action: 'promote',
        sourceEnv: 'preprod',
        targetEnv: 'prod',
        options: { cascade: true },
        label: 'Promouvoir Facturation vers PROD',
      }),
      expect.objectContaining({ position: 1, kind: 'manual', label: 'Créer la credential Stripe' }),
    ]);
    expect((await service.get(procedure.id)).steps[0].label).toBe('Promouvoir Facturation vers PREPROD');

    const named = await service.duplicate(
      procedure.id,
      { sourceEnv: 'preprod', targetEnv: 'prod', name: ' Mise en prod ' },
      ME,
    );
    expect(named.name).toBe('Mise en prod');
  });

  it('refuse une duplication qui ne décalerait rien ou vers un env non déclaré', async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release', ME);
    await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/promote/${dev.id}`,
      body: { targetEnv: 'preprod' },
    });
    const to = (sourceEnv: string, targetEnv: string) =>
      service.duplicate(procedure.id, { sourceEnv, targetEnv }, ME);

    await expect(to('preprod', 'prod')).rejects.toThrow(/en cours/);
    await service.stop(procedure.id);
    await expect(to('dev', 'preprod')).rejects.toThrow(/même saut/i);
    await expect(to('preprod', 'preprod')).rejects.toThrow(/deux envs/);
    await expect(to('preprod', 'recette')).rejects.toThrow(/RECETTE/);

    const manualOnly = await service.start('Checklist', ME);
    await service.addManual(manualOnly.id, { label: 'Prévenir le client' });
    await service.stop(manualOnly.id);
    await expect(
      service.duplicate(manualOnly.id, { sourceEnv: 'preprod', targetEnv: 'prod' }, ME),
    ).rejects.toThrow(/Aucune promotion/);
  });

  it('réordonne les étapes et renumérote après une suppression', async () => {
    const procedure = await service.start('Checklist', ME);
    for (const label of ['A', 'B', 'C', 'D']) await service.addManual(procedure.id, { label });
    const ids = (await service.get(procedure.id)).steps.map((step) => step.id);

    await service.reorder(procedure.id, { order: [ids[2], ids[0], ids[3], ids[1]] });
    await service.removeStep(procedure.id, ids[0]);

    const steps = (await service.get(procedure.id)).steps;
    expect(steps.map((step) => [step.position, step.label])).toEqual([
      [0, 'C'],
      [1, 'D'],
      [2, 'B'],
    ]);
  });

  it("refuse un ordre incomplet, et ne bouge pas les étapes déjà jouées d'un rejeu", async () => {
    const procedure = await service.start('Checklist', ME);
    for (const label of ['A', 'B', 'C']) await service.addManual(procedure.id, { label });
    const [a, b, c] = (await service.get(procedure.id)).steps.map((step) => step.id);

    await expect(service.reorder(procedure.id, { order: [a, b] })).rejects.toThrow(/exactement/);
    await expect(service.reorder(procedure.id, { order: [b, a, c], frozen: 1 })).rejects.toThrow(
      /déjà jouées/,
    );
    await service.reorder(procedure.id, { order: [a, c, b], frozen: 1 });
    expect((await service.get(procedure.id)).steps.map((step) => step.label)).toEqual(['A', 'C', 'B']);

    await service.addManual(procedure.id, { label: 'Z', position: 0, frozen: 1 });
    expect((await service.get(procedure.id)).steps.map((step) => step.label)).toEqual(['A', 'Z', 'C', 'B']);
  });

  it('pose à la main un geste rejouable, à sa place, avec sa note — et en retient le saut', async () => {
    const procedure = await service.start('Mise en ligne', ME);
    await service.addManual(procedure.id, { label: 'Prévenir le client' });
    await service.stop(procedure.id);

    const step = await service.addGesture(procedure.id, {
      action: 'promote',
      familyKey: 'facturation',
      familyName: 'Facturation',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      options: { cascade: true, force: true },
      position: 0,
      note: '  Après 18 h  ',
    });

    expect(step).toMatchObject({
      position: 0,
      kind: 'auto',
      action: 'promote',
      options: { cascade: true },
      label: 'Promouvoir Facturation vers PREPROD',
      note: 'Après 18 h',
    });
    const saved = await service.get(procedure.id);
    expect(saved).toMatchObject({ sourceEnv: 'dev', targetEnv: 'preprod' });
    expect(saved.steps.map((row) => row.label)).toEqual([
      'Promouvoir Facturation vers PREPROD',
      'Prévenir le client',
    ]);

    await expect(
      service.addGesture(procedure.id, {
        action: 'promote',
        familyKey: 'facturation',
        familyName: 'Facturation',
        sourceEnv: 'dev',
        targetEnv: 'recette',
      }),
    ).rejects.toThrow(/RECETTE/);
  });

  it("modifie la note de toute étape, le libellé d'une manuelle seulement", async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release', ME);
    await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/promote/${dev.id}`,
      body: { targetEnv: 'preprod' },
    });
    const manual = await service.addManual(procedure.id, { label: 'Créer la credential', note: 'Clé live' });
    const [auto] = (await service.get(procedure.id)).steps;

    expect(manual.note).toBe('Clé live');
    expect(
      await service.updateStep(procedure.id, manual.id, { label: 'Créer la credential Stripe', note: ' ' }),
    ).toMatchObject({ label: 'Créer la credential Stripe', note: null });
    expect(await service.updateStep(procedure.id, auto.id, { note: 'Vérifier la cible' })).toMatchObject({
      label: 'Promouvoir Facturation vers PREPROD',
      note: 'Vérifier la cible',
    });
    await expect(service.updateStep(procedure.id, auto.id, { label: 'Autre chose' })).rejects.toThrow(
      /libellé/,
    );
    await expect(service.updateStep(procedure.id, manual.id, { label: '  ' })).rejects.toThrow();
  });

  it("refait le geste d'une étape, et relit le saut quand c'est elle qui le disait", async () => {
    const procedure = await service.start('Release', ME);
    await service.stop(procedure.id);
    const gesture = {
      familyKey: 'facturation',
      familyName: 'Facturation',
    };
    const promote = await service.addGesture(procedure.id, {
      ...gesture,
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      note: 'Après 18 h',
    });
    const manual = await service.addManual(procedure.id, { label: 'Prévenir le client' });

    const updated = await service.updateGesture(procedure.id, promote.id, {
      ...gesture,
      action: 'duplicate',
      sourceEnv: 'preprod',
      targetEnv: 'prod',
      options: { cascade: false, force: true },
    });
    expect(updated).toMatchObject({
      id: promote.id,
      position: 0,
      action: 'duplicate',
      options: { cascade: false },
      label: 'Dupliquer Facturation vers PROD',
      note: 'Après 18 h',
    });
    expect(await service.get(procedure.id)).toMatchObject({ sourceEnv: 'preprod', targetEnv: 'prod' });

    // Devenu une déclaration, il ne dit plus de saut : le saut connu est gardé.
    await service.updateGesture(procedure.id, promote.id, {
      ...gesture,
      action: 'mark',
      targetEnv: 'dev',
      note: '',
    });
    expect(await service.get(procedure.id)).toMatchObject({
      sourceEnv: 'preprod',
      targetEnv: 'prod',
      steps: [{ label: 'Déclarer Facturation en DEV', note: null }, { label: 'Prévenir le client' }],
    });

    await expect(
      service.updateGesture(procedure.id, manual.id, { ...gesture, action: 'mark', targetEnv: 'dev' }),
    ).rejects.toThrow(/geste/);
    await expect(
      service.updateGesture(procedure.id, promote.id, { ...gesture, action: 'promote', sourceEnv: 'dev' }),
    ).rejects.toThrow(/cible/);
    await expect(
      service.updateGesture(procedure.id, promote.id, {
        ...gesture,
        action: 'mark',
        targetEnv: 'prod',
        frozen: 1,
      }),
    ).rejects.toThrow(/jouées/);
  });

  it("recopie les notes d'une procédure dupliquée", async () => {
    const dev = await workflow('Facturation - DEV');
    const procedure = await service.start('Release', ME);
    await service.capture(ME, {
      method: 'POST',
      path: `/env-switcher/promote/${dev.id}`,
      body: { targetEnv: 'preprod' },
    });
    const [step] = (await service.get(procedure.id)).steps;
    await service.updateStep(procedure.id, step.id, { note: 'Prévenir le client avant' });
    await service.stop(procedure.id);

    const copy = await service.duplicate(procedure.id, { sourceEnv: 'preprod', targetEnv: 'prod' }, ME);
    expect(copy.steps[0]).toMatchObject({ targetEnv: 'prod', note: 'Prévenir le client avant' });
  });

  it('un seul enregistrement à la fois : en démarrer un clôt le précédent', async () => {
    const first = await service.start('A', ME);
    const second = await service.start('B', ME);
    expect((await service.get(first.id)).status).toBe('ready');
    expect((await service.active(ME))?.id).toBe(second.id);
    await service.stop(second.id);
    expect(await service.active(ME)).toBeNull();
  });

  it("résout l'exemplaire d'un env pour le rejeu, jamais un archivé", async () => {
    await workflow('Facturation - PROD', { archivedUpstream: true });
    const prod = await workflow('Facturation', { tags: ['env:prod'] });
    await workflow('Facturation - DEV');
    expect(await service.resolve('facturation', 'prod')).toEqual({ workflowId: prod.id, active: false });
    await expect(service.resolve('facturation', 'preprod')).rejects.toThrow(/PREPROD/);
  });
});
