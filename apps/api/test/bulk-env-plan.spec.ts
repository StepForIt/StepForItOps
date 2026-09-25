import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENVS } from '@nwm/core';
import { BulkEnvPlanService } from '../src/modules/env-switcher/bulk-env-plan.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Le plan d'un lot d'actions d'environnement, lu sur le miroir : c'est lui qui
 * dit, famille par famille, quel exemplaire part et vers quelle instance. Les
 * gates viennent après, par la preview de chaque geste.
 */

const prisma = testPrisma() as unknown as PrismaService;

const settings = {
  async get() {
    return { envs: DEFAULT_ENVS, includeArchived: false, includeMissing: false };
  },
  async declaredEnvIds() {
    return DEFAULT_ENVS.map((env) => env.id);
  },
  async archivedFilter() {
    return [];
  },
  async missingFilter() {
    return [];
  },
  testerFilter() {
    return [];
  },
} as unknown as PlatformSettingsService;

const service = new BulkEnvPlanService(
  new WorkflowsService(prisma, settings, {} as WorkflowSyncService),
  settings,
);

async function instance(name: string) {
  return prisma.instance.create({ data: { name, baseUrl: `http://${name}`, apiKey: 'k' } });
}

async function workflow(instanceId: string, name: string, extra: { archivedUpstream?: boolean } = {}) {
  return prisma.workflow.create({
    data: { instanceId, externalId: name, name, active: false, tags: [], hash: 'h', raw: {}, ...extra },
  });
}

describe('BulkEnvPlanService', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('résout chaque famille vers l’instance où vit déjà son env cible', async () => {
    const dev = await instance('dev');
    const prod = await instance('prod');
    const source = await workflow(dev.id, 'Facturation - DEV');
    const target = await workflow(prod.id, 'Facturation - PROD');
    const lonely = await workflow(dev.id, 'Relances - DEV');

    const rows = await service.plan({
      action: 'promote',
      familyKeys: ['facturation', 'relances'],
      sourceEnv: 'dev',
      targetEnv: 'prod',
      fallbackInstanceId: prod.id,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'planned',
        sourceId: source.id,
        targetInstanceId: prod.id,
        targetExemplarId: target.id,
      }),
      expect.objectContaining({ status: 'planned', sourceId: lonely.id, targetInstanceId: prod.id }),
    ]);
  });

  it('annonce une famille demandée mais introuvable plutôt que de la taire', async () => {
    const rows = await service.plan({
      action: 'promote',
      familyKeys: ['disparu'],
      sourceEnv: 'dev',
      targetEnv: 'prod',
    });
    expect(rows).toEqual([expect.objectContaining({ familyKey: 'disparu', status: 'skipped' })]);
  });

  it('ne prend jamais un exemplaire archivé dans n8n comme source', async () => {
    const dev = await instance('dev');
    await workflow(dev.id, 'Facturation - DEV', { archivedUpstream: true });

    const [row] = await service.plan({
      action: 'duplicate',
      familyKeys: ['facturation'],
      sourceEnv: 'dev',
      targetEnv: 'preprod',
    });
    expect(row.status).toBe('skipped');
  });

  it('refuse un env non déclaré', async () => {
    await expect(
      service.plan({ action: 'promote', familyKeys: ['x'], sourceEnv: 'dev', targetEnv: 'qualif' }),
    ).rejects.toThrow(/non déclaré/);
  });

  it('exige de partir des exemplaires sans env pour les déclarer', async () => {
    await expect(
      service.plan({ action: 'mark', familyKeys: ['x'], sourceEnv: 'dev', targetEnv: 'prod' }),
    ).rejects.toThrow(/sans env/);
  });
});
