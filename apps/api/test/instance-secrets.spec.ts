import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nApiPort, WorkflowPlatformPorts } from '@nwm/core';
import { PrismaClient } from '@prisma/client';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SecretCipher } from '../src/infra/secrets/secret-cipher';
import { withSecretEncryption } from '../src/infra/secrets/secret-encryption';
import { prepareInstanceSecrets } from '../src/infra/secrets/secrets-bootstrap';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Les secrets d'instance (clé API, mot de passe du compte n8n) sont chiffrés au
 * repos sans qu'aucun service n'ait à le savoir : la base ne porte que du
 * chiffré, tout ce qui lit par Prisma reçoit le clair — lecture directe,
 * imbriquée ou en transaction. Ce que la base contient se lit donc en SQL brut.
 */

const cipher = new SecretCipher(randomBytes(32).toString('base64'));
const encrypted = () => withSecretEncryption(testPrisma(), cipher) as unknown as PrismaService;
const instances = (prisma: PrismaService) =>
  new InstancesService(prisma, {} as N8nApiPort, {} as WorkflowPlatformPorts);
const silent = { log: () => undefined, warn: () => undefined };

async function stored(): Promise<Array<{ apiKey: string; n8nPassword: string | null }>> {
  return testPrisma().$queryRaw`SELECT "apiKey", "n8nPassword" FROM "Instance" ORDER BY name`;
}

const base = { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'n8n_api_secret' };

describe('secrets d’instance chiffrés au repos', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('la base ne porte que du chiffré, les services lisent le clair', async () => {
    const prisma = encrypted();
    const created = await instances(prisma).create({ ...base, n8nEmail: 'o@n8n', n8nPassword: 'pw-n8n' });

    const [row] = await stored();
    expect(row.apiKey.startsWith('enc:v1:')).toBe(true);
    expect(row.n8nPassword?.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/n8n_api_secret|pw-n8n/);

    expect(created.hasN8nLogin).toBe(true);
    expect(await instances(prisma).getConfig(created.id)).toMatchObject({
      apiKey: 'n8n_api_secret',
      login: { email: 'o@n8n', password: 'pw-n8n' },
    });
  });

  it('déchiffre aussi les lectures imbriquées et en transaction', async () => {
    const prisma = encrypted();
    const instance = await prisma.instance.create({ data: base });
    await prisma.workflow.create({
      data: {
        instanceId: instance.id,
        externalId: 'w',
        name: 'W',
        active: false,
        tags: [],
        hash: 'h',
        raw: {},
      },
    });

    const workflow = await prisma.workflow.findFirst({ include: { instance: true } });
    expect(workflow?.instance.apiKey).toBe('n8n_api_secret');
    const inTx = await prisma.$transaction((tx) => tx.instance.findFirst({ select: { apiKey: true } }));
    expect(inTx?.apiKey).toBe('n8n_api_secret');
  });

  it('chiffre chaque forme d’écriture : update, upsert, createMany', async () => {
    const prisma = encrypted();
    const { id } = await prisma.instance.create({ data: base });
    await prisma.instance.update({ where: { id }, data: { apiKey: { set: 'k2' }, n8nPassword: 'p2' } });
    await prisma.instance.upsert({
      where: { id: '00000000-0000-0000-0000-000000000000' },
      create: { ...base, name: 'Recette', apiKey: 'k3' },
      update: {},
    });
    await prisma.instance.createMany({ data: [{ ...base, name: 'Zeta', apiKey: 'k4' }] });

    for (const row of await stored()) expect(row.apiKey.startsWith('enc:v1:')).toBe(true);
    const keys = (await prisma.instance.findMany({ orderBy: { name: 'asc' } })).map((i) => i.apiKey);
    expect(keys).toEqual(['k2', 'k3', 'k4']);
  });

  it('sans clé, rien ne change : les secrets restent lisibles en clair', async () => {
    const prisma = withSecretEncryption(testPrisma(), null) as unknown as PrismaService;
    await instances(prisma).create(base);
    expect((await stored())[0].apiKey).toBe('n8n_api_secret');
  });
});

describe('prepareInstanceSecrets — au démarrage', () => {
  beforeEach(resetDb);

  it('chiffre les secrets d’avant le chiffrement, une seule fois', async () => {
    await (testPrisma() as PrismaClient).instance.create({ data: { ...base, n8nPassword: 'pw' } });

    expect(await prepareInstanceSecrets(testPrisma(), cipher, silent)).toEqual({ encrypted: 1 });
    expect(await prepareInstanceSecrets(testPrisma(), cipher, silent)).toEqual({ encrypted: 0 });

    const [row] = await stored();
    expect(row.apiKey.startsWith('enc:v1:')).toBe(true);
    expect(row.n8nPassword?.startsWith('enc:v1:')).toBe(true);
    expect((await encrypted().instance.findFirst())?.apiKey).toBe('n8n_api_secret');
  });

  it('refuse de démarrer sans clé quand des secrets sont déjà chiffrés', async () => {
    await encrypted().instance.create({ data: base });
    await expect(prepareInstanceSecrets(testPrisma(), null, silent)).rejects.toThrow(/SECRETS_KEY/);
  });

  it('refuse de démarrer avec une autre clé', async () => {
    await encrypted().instance.create({ data: base });
    const other = new SecretCipher(randomBytes(32).toString('base64'));
    await expect(prepareInstanceSecrets(testPrisma(), other, silent)).rejects.toThrow(/SECRETS_KEY/);
  });

  it('sans clé ni secret chiffré : démarre, en avertissant', async () => {
    await (testPrisma() as PrismaClient).instance.create({ data: base });
    const warnings: string[] = [];
    await expect(
      prepareInstanceSecrets(testPrisma(), null, { log: () => undefined, warn: (m) => warnings.push(m) }),
    ).resolves.toEqual({ encrypted: 0 });
    expect(warnings.join()).toMatch(/SECRETS_KEY/);
  });
});
