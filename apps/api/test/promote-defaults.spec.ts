import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PromoteDefaultsService } from '../src/modules/env-switcher/promote-defaults.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { resetDb, testPrisma } from './helpers/db';

/** La cible que l'écran de promotion propose avant qu'on ait rien choisi. */

const prisma = testPrisma() as unknown as PrismaService;
const service = new PromoteDefaultsService(prisma, new PlatformSettingsService(prisma));

async function workflow(name: string, tags: string[] = []) {
  const instance = await prisma.instance.create({
    data: { name: 'Neon', baseUrl: 'http://neon', apiKey: 'k' },
  });
  const row = await prisma.workflow.create({
    data: { instanceId: instance.id, externalId: '1', name, active: false, tags, hash: 'h', raw: {} },
  });
  return { id: row.id, instanceId: instance.id };
}

describe('PromoteDefaultsService', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("propose la même instance et l'étape suivante, pas la prod", async () => {
    const source = await workflow('Facturation - DEV');
    expect(await service.defaults(source.id)).toEqual({
      sourceEnv: 'dev',
      targetInstanceId: source.instanceId,
      targetEnv: 'preprod',
    });
  });

  it("lit l'env sur le tag quand le nom n'en porte pas", async () => {
    const source = await workflow('Facturation', ['env:preprod']);
    expect((await service.defaults(source.id)).targetEnv).toBe('prod');
  });

  it('ne propose aucun env au bout de la chaîne ni pour un env indéterminé', async () => {
    const prod = await workflow('Facturation - PROD');
    expect((await service.defaults(prod.id)).targetEnv).toBeNull();
    const unknown = await workflow('Facturation');
    expect(await service.defaults(unknown.id)).toMatchObject({ sourceEnv: null, targetEnv: null });
  });
});
