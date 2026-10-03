import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, N8nApiError, N8nApiPort, WorkflowPlatformPorts } from '@nwm/core';
import { ApiKeyHealthService } from '../src/modules/instances/api-key-health.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { RecordingBus, recordingBus } from './helpers/fakes';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Ce que ces cas tiennent : une alerte par palier franchi et par clé, jamais une
 * par passe du cron ; une clé remplacée repart de zéro ; un refus n'alerte qu'une
 * fois, et sa levée n'alerte pas.
 */

const prisma = testPrisma() as unknown as PrismaService;
const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-09-28T08:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function jwtExpiringAt(date: Date): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'u', exp: Math.floor(date.getTime() / 1000) })}.sig`;
}

function services(bus: RecordingBus) {
  const instances = new InstancesService(prisma, {} as N8nApiPort, {} as WorkflowPlatformPorts);
  const health = new ApiKeyHealthService(prisma, bus as unknown as EventBusService);
  return { instances, health };
}

const expiryEvents = (bus: RecordingBus) =>
  bus.emitted.filter(
    (event) => event.name === EVENTS.instanceApiKeyExpiring || event.name === EVENTS.instanceApiKeyExpired,
  );

describe('ApiKeyHealthService — échéance', () => {
  let bus: RecordingBus;

  beforeEach(async () => {
    await resetDb();
    bus = recordingBus();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it("enregistre l'échéance lue dans la clé, null pour une clé opaque", async () => {
    const { instances } = services(bus);
    // La vue se lit à l'heure réelle : l'échéance part donc d'aujourd'hui.
    const in30Days = new Date(Date.now() + 30 * DAY);
    const dated = await instances.create({ name: 'A', baseUrl: 'http://a', apiKey: jwtExpiringAt(in30Days) });
    const opaque = await instances.create({ name: 'B', baseUrl: 'http://b', apiKey: 'n8n_api_opaque' });

    expect(dated.apiKeyExpiresAt).toEqual(new Date(Math.floor(in30Days.getTime() / 1000) * 1000));
    expect(dated.apiKeyState).toBe('ok');
    expect(opaque.apiKeyExpiresAt).toBeNull();
    expect(opaque.apiKeyState).toBe('unknown');
  });

  it("n'alerte qu'une fois sur deux passes du cron", async () => {
    const { instances, health } = services(bus);
    await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: jwtExpiringAt(at(10)) });

    await health.checkExpiries(NOW);
    await health.checkExpiries(new Date(NOW.getTime() + DAY / 2));

    expect(expiryEvents(bus)).toHaveLength(1);
    expect(expiryEvents(bus)[0]).toMatchObject({
      name: EVENTS.instanceApiKeyExpiring,
      payload: { instanceName: 'Prod', tier: 'J-14' },
    });
  });

  it("une clé déjà expirée au premier passage n'envoie qu'une alerte, pas toute la série", async () => {
    const { instances, health } = services(bus);
    await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: jwtExpiringAt(at(-5)) });

    await health.checkExpiries(NOW);

    expect(expiryEvents(bus)).toEqual([
      expect.objectContaining({
        name: EVENTS.instanceApiKeyExpired,
        payload: expect.objectContaining({ tier: 'expired' }),
      }),
    ]);
  });

  it('alerte chaque palier franchi, dans l’ordre', async () => {
    const { instances, health } = services(bus);
    await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: jwtExpiringAt(at(20)) });

    for (const day of [0, 7, 8, 18, 19, 21, 22]) await health.checkExpiries(at(day));

    expect(expiryEvents(bus).map((event) => (event.payload as { tier: string }).tier)).toEqual([
      'J-14',
      'J-3',
      'expired',
    ]);
  });

  it('se réarme quand la clé change', async () => {
    const { instances, health } = services(bus);
    const instance = await instances.create({
      name: 'Prod',
      baseUrl: 'http://p',
      apiKey: jwtExpiringAt(at(10)),
    });
    await health.checkExpiries(NOW);

    await instances.update(instance.id, { apiKey: jwtExpiringAt(at(12)) });
    await health.checkExpiries(NOW);

    expect(expiryEvents(bus)).toHaveLength(2);
  });

  it('une clé sans date ne produit aucune alerte d’échéance', async () => {
    const { instances, health } = services(bus);
    await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: 'n8n_api_opaque' });

    await health.checkExpiries(NOW);

    expect(expiryEvents(bus)).toEqual([]);
  });

  it("rattrape l'échéance d'une clé enregistrée avant la colonne", async () => {
    const { health } = services(bus);
    const row = await prisma.instance.create({
      data: { name: 'Ancienne', baseUrl: 'http://o', apiKey: jwtExpiringAt(at(2)) },
    });

    await health.checkExpiries(NOW);

    const after = await prisma.instance.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.apiKeyExpiresAt).not.toBeNull();
    expect(expiryEvents(bus)).toHaveLength(1);
  });
});

describe('ApiKeyHealthService — refus', () => {
  let bus: RecordingBus;

  beforeEach(async () => {
    await resetDb();
    bus = recordingBus();
  });

  const rejections = (bus: RecordingBus) =>
    bus.emitted.filter((event) => event.name === EVENTS.instanceApiKeyRejected);

  it('un refus n’alerte qu’une fois, quel que soit le nombre de synchros refusées', async () => {
    const { instances, health } = services(bus);
    const instance = await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: 'n8n_api_x' });
    const refused = () => Promise.reject(new N8nApiError('unauthorized', 401));

    await expect(health.watch(instance.id, refused)).rejects.toThrow('unauthorized');
    await expect(health.watch(instance.id, refused)).rejects.toThrow('unauthorized');

    expect(rejections(bus)).toHaveLength(1);
    expect(rejections(bus)[0].payload).toMatchObject({ instanceName: 'Prod', status: 401 });
    expect((await instances.get(instance.id)).apiKeyRejectedAt).not.toBeNull();
  });

  it("l'appel accepté efface le refus sans rien émettre, et un nouveau refus réalerte", async () => {
    const { instances, health } = services(bus);
    const instance = await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: 'n8n_api_x' });
    const refused = () => Promise.reject(new N8nApiError('forbidden', 403));

    await health.watch(instance.id, refused).catch(() => undefined);
    await expect(health.watch(instance.id, async () => 'ok')).resolves.toBe('ok');
    expect((await instances.get(instance.id)).apiKeyRejectedAt).toBeNull();
    expect(rejections(bus)).toHaveLength(1);

    await health.watch(instance.id, refused).catch(() => undefined);
    expect(rejections(bus)).toHaveLength(2);
  });

  it("une panne qui n'est pas un refus ne marque rien", async () => {
    const { instances, health } = services(bus);
    const instance = await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: 'n8n_api_x' });

    await health.watch(instance.id, () => Promise.reject(new Error('ECONNREFUSED'))).catch(() => undefined);

    expect(rejections(bus)).toEqual([]);
    expect((await instances.get(instance.id)).apiKeyRejectedAt).toBeNull();
  });

  it('une nouvelle clé efface le refus', async () => {
    const { instances, health } = services(bus);
    const instance = await instances.create({ name: 'Prod', baseUrl: 'http://p', apiKey: 'n8n_api_x' });
    await health.watch(instance.id, () => Promise.reject(new N8nApiError('no', 401))).catch(() => undefined);

    const updated = await instances.update(instance.id, { apiKey: 'n8n_api_y' });

    expect(updated.apiKeyRejectedAt).toBeNull();
  });
});
