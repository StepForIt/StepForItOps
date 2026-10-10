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

  it('annonce une credential IA refusée ou à sec sur les mêmes canaux, en nommant le fournisseur', async () => {
    await prisma.notificationChannel.create({
      data: { name: 'Suivi', type: 'slack', url: 'https://hooks.example/on' },
    });
    const port = recordingPort();
    const registry = { isEnabled: async () => true } as unknown as ModuleRegistryService;
    const notifier = new NotifierService(prisma, registry, port);
    const base = {
      instanceId: 'i1',
      instanceName: 'Prod',
      credentialId: 'c1',
      credentialName: 'Perplexity prod',
      provider: 'perplexity',
      detail: 'Insufficient credits',
      occurredAt: '2026-10-08T08:00:00.000Z',
    };

    await notifier.onCredentialCheckFailed({ ...base, verdict: 'no-credit' });
    await notifier.onCredentialCheckFailed({ ...base, verdict: 'rejected' });

    expect(port.sent).toHaveLength(2);
    expect(port.sent[0].title).toContain('à sec');
    expect(port.sent[0].title).toContain('Perplexity prod');
    expect(port.sent[1].title).toContain('refusée');
  });
});
