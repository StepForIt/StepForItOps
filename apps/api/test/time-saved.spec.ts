import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiPort, N8nWorkflow, estimateTimeSaved } from '@nwm/core';
import { TimeSavedService } from '../src/modules/workflows/time-saved.service';
import { PlatformLocale } from '../src/infra/i18n/platform-locale';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Le rattrapage au démarrage : une formule corrigée doit atteindre les workflows
 * que la synchro ne revoit pas (contenu inchangé), sans écraser un jugement.
 */

const prisma = testPrisma() as unknown as PrismaService;

/** Assez de nœuds pour que l'ancienne formule additive donne un chiffre énorme. */
function bigWorkflow(): N8nWorkflow {
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    id: `n${i}`,
    name: `Lire ${i}`,
    type: 'n8n-nodes-base.gmail',
    typeVersion: 1,
    position: [0, 0],
    parameters: { operation: 'get' },
  }));
  return { id: '1', name: 'Tri de mails', nodes, connections: {}, active: true } as unknown as N8nWorkflow;
}

function makeService(): TimeSavedService {
  const locale = { run: <T>(fn: () => T) => fn() } as unknown as PlatformLocale;
  return new TimeSavedService(prisma, {} as AiPort, locale);
}

describe('TimeSavedService.onModuleInit', () => {
  let instanceId: string;

  beforeEach(async () => {
    await resetDb();
    instanceId = (
      await prisma.instance.create({ data: { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'k' } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(externalId: string, extra: Record<string, unknown>) {
    return prisma.workflow.create({
      data: {
        instanceId,
        externalId,
        name: `W${externalId}`,
        hash: externalId,
        raw: bigWorkflow() as unknown as object,
        ...extra,
      },
    });
  }

  it('recalcule une estimation de la règle, laisse celle de l’IA et la saisie manuelle', async () => {
    const byRules = await seed('1', { minutesSavedEstimate: 110, minutesSavedEstimateFrom: 'rules' });
    const byAi = await seed('2', { minutesSavedEstimate: 99, minutesSavedEstimateFrom: 'ai' });
    const manual = await seed('3', {
      minutesSavedEstimate: 110,
      minutesSavedEstimateFrom: 'rules',
      minutesSavedPerExecution: 7,
    });

    await makeService().onModuleInit();

    const expected = estimateTimeSaved(bigWorkflow()).minutes;
    expect(expected).toBeLessThanOrEqual(30);
    expect(
      (await prisma.workflow.findUniqueOrThrow({ where: { id: byRules.id } })).minutesSavedEstimate,
    ).toBe(expected);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: byAi.id } })).minutesSavedEstimate).toBe(
      99,
    );
    // La saisie prime toujours : elle n'est pas touchée, et l'estimation à côté se met à jour sans conséquence.
    expect(
      (await prisma.workflow.findUniqueOrThrow({ where: { id: manual.id } })).minutesSavedPerExecution,
    ).toBe(7);
  });

  it('pose une estimation sur un workflow qui n’en avait pas', async () => {
    const row = await seed('4', {});
    await makeService().onModuleInit();
    const stored = await prisma.workflow.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.minutesSavedEstimate).toBe(estimateTimeSaved(bigWorkflow()).minutes);
    expect(stored.minutesSavedEstimateFrom).toBe('rules');
  });
});
