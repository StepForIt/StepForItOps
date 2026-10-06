import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { EventLogPurgeService } from '../src/infra/events/event-log-purge.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Ce que ces cas tiennent : le journal ne recopie plus le contenu d'un workflow
 * (les abonnés, eux, le reçoivent entier), et la purge ne retire jamais la
 * dernière ligne d'un nom — ops-cloud y lit la date de la dernière synchro.
 */

const prisma = testPrisma() as unknown as PrismaService;
const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-10-05T03:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('journal des événements', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("journalise les ids d'un workflow.synced, pas son contenu", async () => {
    const emitter = new EventEmitter2();
    const received: unknown[] = [];
    emitter.on(EVENTS.workflowSynced, (payload) => received.push(payload));
    const raw = {
      nodes: Array.from({ length: 50 }, (_, i) => ({
        name: `Node ${i}`,
        parameters: { text: 'x'.repeat(40) },
      })),
    };

    new EventBusService(emitter, prisma).emit(EVENTS.workflowSynced, { workflowId: 'w1', raw });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toEqual([{ workflowId: 'w1', raw }]);
    const [row] = await prisma.eventLog.findMany();
    expect(row.payload).toEqual({ workflowId: 'w1', raw: { omittedBytes: JSON.stringify(raw).length } });
  });

  it('purge au-delà de 30 jours, sauf la dernière ligne de chaque nom', async () => {
    await prisma.eventLog.createMany({
      data: [
        { id: 'sync-old', name: 'instance.synced', createdAt: daysAgo(60) },
        { id: 'sync-last', name: 'instance.synced', createdAt: daysAgo(40) },
        { id: 'wf-old', name: 'workflow.synced', createdAt: daysAgo(45) },
        { id: 'wf-recent', name: 'workflow.synced', createdAt: daysAgo(2) },
        { id: 'wf-recent-2', name: 'workflow.synced', createdAt: daysAgo(1) },
      ],
    });

    const removed = await new EventLogPurgeService(prisma).purge(NOW);

    expect(removed).toBe(2);
    const left = await prisma.eventLog.findMany({ orderBy: { id: 'asc' } });
    expect(left.map((row) => row.id)).toEqual(['sync-last', 'wf-recent', 'wf-recent-2']);
  });
});
