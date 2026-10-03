import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENVS } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { ReleaseProceduresService } from '../src/modules/release-procedures/release-procedures.service';
import { ReleaseProceduresTransferService } from '../src/modules/release-procedures/release-procedures-transfer.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Export et import de procédures : ce qui sort se rejoue ailleurs, et ce qui entre
 * ne remplace rien sans qu'on l'ait demandé.
 */

const prisma = testPrisma() as unknown as PrismaService;
const settings = {
  async declaredEnvIds() {
    return DEFAULT_ENVS.map((env) => env.id);
  },
} as unknown as PlatformSettingsService;
const procedures = new ReleaseProceduresService(prisma, settings);
const transfer = new ReleaseProceduresTransferService(prisma, settings);
const ME = 'moi@stepforit.fr';

async function seedProcedure(name: string) {
  const procedure = await procedures.start(name, ME);
  await procedures.addGesture(procedure.id, {
    action: 'promote',
    familyKey: 'facturation',
    familyName: 'Facturation',
    sourceEnv: 'dev',
    targetEnv: 'preprod',
    options: { cascade: true },
  });
  await procedures.addManual(procedure.id, { label: 'Créer la credential Stripe', note: 'compte prod' });
  return procedures.stop(procedure.id);
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ReleaseProceduresTransferService', () => {
  it('exporte puis réimporte une procédure identique, prête, au nom de qui importe', async () => {
    const original = await seedProcedure('Release septembre');
    const bundle = await transfer.export([original.id]);
    await resetDb();

    const report = await transfer.import({ bundle }, 'autre@stepforit.fr');
    expect(report).toMatchObject({ created: 1, skipped: 0, replaced: 0 });
    const [imported] = await procedures.list();
    expect(imported).toMatchObject({
      name: 'Release septembre',
      status: 'ready',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      recordedBy: 'autre@stepforit.fr',
    });
    expect(imported.steps.map((step) => [step.kind, step.action, step.note])).toEqual([
      ['auto', 'promote', null],
      ['manual', null, 'compte prod'],
    ]);
  });

  it("sans ids, exporte toutes les procédures prêtes et jamais celle qu'on enregistre", async () => {
    await seedProcedure('A');
    await seedProcedure('B');
    await procedures.start('En cours', ME);
    const bundle = await transfer.export();
    expect(bundle.procedures.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('le dry-run annonce sans rien écrire, et un homonyme est sauté par défaut', async () => {
    const original = await seedProcedure('Release septembre');
    const bundle = await transfer.export([original.id]);

    const dry = await transfer.import({ bundle, dryRun: true }, ME);
    expect(dry.rows[0]).toMatchObject({ status: 'existing', outcome: 'skip' });
    // Le workflow Facturation n'est pas dans le miroir : averti, pas bloquant.
    expect(dry.rows[0].warnings.join(' ')).toContain('Facturation');
    expect(await prisma.releaseProcedure.count()).toBe(1);

    await transfer.import({ bundle }, ME);
    expect(await prisma.releaseProcedure.count()).toBe(1);
  });

  it('remplace ou duplique sur demande', async () => {
    const original = await seedProcedure('Release septembre');
    const bundle = await transfer.export([original.id]);

    await transfer.import({ bundle, onConflict: 'duplicate' }, ME);
    expect((await procedures.list()).map((p) => p.name).sort()).toEqual([
      'Release septembre',
      'Release septembre (2)',
    ]);

    const replaced = await transfer.import({ bundle, onConflict: 'replace' }, ME);
    expect(replaced.replaced).toBe(1);
    expect(await prisma.releaseProcedure.count()).toBe(2);
    expect(await prisma.releaseProcedure.findFirst({ where: { id: original.id } })).toBeNull();
  });

  it('refuse un fichier qui n’en est pas un', async () => {
    await expect(transfer.import({ bundle: { hello: 'world' } }, ME)).rejects.toThrow();
  });
});
