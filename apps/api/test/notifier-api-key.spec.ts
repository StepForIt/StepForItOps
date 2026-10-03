import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationMessage, NotificationPort } from '@nwm/core';
import { NotifierService } from '../src/modules/notifier/notifier.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { resetDb, testPrisma } from './helpers/db';

const prisma = testPrisma() as unknown as PrismaService;

function recordingPort(): NotificationPort & { sent: Array<{ url: string; title: string }> } {
  const sent: Array<{ url: string; title: string }> = [];
  return {
    sent,
    async sendSlack(url: string, message: NotificationMessage) {
      sent.push({ url, title: message.title });
    },
    async sendWebhook(url: string, payload: { title: string }) {
      sent.push({ url, title: payload.title });
    },
  } as unknown as NotificationPort & { sent: Array<{ url: string; title: string }> };
}

describe('NotifierService — clés API', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it("n'écrit qu'aux canaux qui suivent les clés API", async () => {
    await prisma.notificationChannel.create({
      data: { name: 'Suivi', type: 'slack', url: 'https://hooks.example/on' },
    });
    await prisma.notificationChannel.create({
      data: { name: 'Muet', type: 'slack', url: 'https://hooks.example/off', onApiKey: false },
    });
    const port = recordingPort();
    const registry = { isEnabled: async () => true } as unknown as ModuleRegistryService;
    const notifier = new NotifierService(prisma, registry, port);

    await notifier.onApiKeyExpiring({
      instanceId: 'i1',
      instanceName: 'Prod',
      tier: 'J-3',
      expiresAt: '2026-10-01T00:00:00.000Z',
      occurredAt: '2026-09-28T08:00:00.000Z',
    });
    await notifier.onApiKeyRejected({
      instanceId: 'i1',
      instanceName: 'Prod',
      status: 401,
      reason: 'unauthorized',
      occurredAt: '2026-09-28T08:00:00.000Z',
    });

    expect(port.sent.map((sent) => sent.url)).toEqual([
      'https://hooks.example/on',
      'https://hooks.example/on',
    ]);
    expect(port.sent[0].title).toContain('Prod');
  });
});
