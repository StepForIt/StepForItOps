import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, N8nApiError, N8nApiPort, N8nWorkflow, WorkflowSyncedEvent } from '@nwm/core';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { TimeSavedService } from '../src/modules/workflows/time-saved.service';
import { RecordingBus, recordingBus } from './helpers/fakes';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Le miroir local, contre une vraie base.
 *
 * Ce que ces cas tiennent, ce sont trois promesses que la plateforme fait
 * ailleurs et qui ne se voient nulle part dans le code appelant : un workflow
 * que n8n ne connaît plus est ESTAMPILLÉ et jamais supprimé (versions et
 * historique d'erreurs restent consultables) ; l'estampille n'est pas réécrite
 * à chaque passe, sinon la date ne dirait plus depuis quand ; et le contenu
 * n'est redemandé que s'il a bougé, l'économie d'appels qui rend une passe Make
 * tenable.
 */

const prisma = testPrisma() as unknown as PrismaService;

function n8nWorkflow(id: string, name: string, extra: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return { id, name, nodes: [], connections: {}, active: false, ...extra } as N8nWorkflow;
}

/** Un port n8n qui sert des workflows en mémoire et compte ce qu'on lui demande. */
function fakeN8n(workflows: N8nWorkflow[]): N8nApiPort & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async listWorkflows() {
      return workflows;
    },
    async getWorkflow(_config: unknown, externalId: string) {
      fetched.push(externalId);
      const found = workflows.find((workflow) => String(workflow.id) === externalId);
      if (!found) throw new N8nApiError(`Workflow ${externalId} introuvable`, 404);
      return found;
    },
  } as unknown as N8nApiPort & { fetched: string[] };
}

function makeService(n8n: N8nApiPort, bus: RecordingBus, estimates: { calls: number }): WorkflowSyncService {
  const instances = {
    async getPlatformConfig() {
      return { platform: 'n8n', port: {}, config: { baseUrl: 'http://n8n', apiKey: 'k' } };
    },
    async getConfig() {
      return { baseUrl: 'http://n8n', apiKey: 'k' };
    },
  } as unknown as InstancesService;
  const timeSaved = {
    estimateFields() {
      estimates.calls += 1;
      return { minutesSavedEstimate: 5 };
    },
  } as unknown as TimeSavedService;
  return new WorkflowSyncService(prisma, bus as unknown as EventBusService, instances, timeSaved, n8n);
}

async function makeInstance(): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'k' },
  });
  return instance.id;
}

describe('WorkflowSyncService', () => {
  let bus: RecordingBus;
  let estimates: { calls: number };

  beforeEach(async () => {
    await resetDb();
    bus = recordingBus();
    estimates = { calls: 0 };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('copie les workflows de l’instance et annonce chacun d’eux', async () => {
    const instanceId = await makeInstance();
    const service = makeService(
      fakeN8n([n8nWorkflow('1', 'Facturation'), n8nWorkflow('2', 'Relances')]),
      bus,
      estimates,
    );

    const report = await service.syncInstance(instanceId);

    expect(report).toMatchObject({ synced: 2, changed: 2, recovered: 0, missing: 0 });
    const stored = await prisma.workflow.findMany({ orderBy: { externalId: 'asc' } });
    expect(stored.map((workflow) => workflow.name)).toEqual(['Facturation', 'Relances']);
    const synced = bus.emitted.filter((event) => event.name === EVENTS.workflowSynced);
    expect(synced).toHaveLength(2);
    // La fin de passe est annoncée à part : un workflow supprimé n'émet aucun
    // `workflow.synced`, donc les abonnés qui s'intéressent à l'ÉTAT du parc
    // n'ont que celui-là.
    expect(bus.emitted.at(-1)?.name).toBe(EVENTS.instanceSynced);
  });

  it('n’écrase pas une estimation affinée quand le contenu n’a pas bougé', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const service = makeService(fakeN8n(workflows), bus, estimates);
    await service.syncInstance(instanceId);
    // Ce que l'IA a affiné à la demande, workflow par workflow : le contenu n'a
    // pas bougé, donc l'estimation le décrit toujours.
    await prisma.workflow.updateMany({ data: { minutesSavedEstimate: 42 } });

    await service.syncInstance(instanceId);

    expect((await prisma.workflow.findFirstOrThrow()).minutesSavedEstimate).toBe(42);
    const second = bus.emitted.filter((event) => event.name === EVENTS.workflowSynced).at(-1);
    expect((second?.payload as WorkflowSyncedEvent).hashChanged).toBe(false);
  });

  it('réestime dès que le contenu change, l’affinage devenant caduc', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const service = makeService(fakeN8n(workflows), bus, estimates);
    await service.syncInstance(instanceId);
    await prisma.workflow.updateMany({ data: { minutesSavedEstimate: 42 } });

    workflows[0] = n8nWorkflow('1', 'Facturation', {
      nodes: [{ name: 'A', type: 'n8n-nodes-base.set' } as never],
    });
    await service.syncInstance(instanceId);

    // 42 décrivait un workflow qui n'existe plus.
    expect((await prisma.workflow.findFirstOrThrow()).minutesSavedEstimate).toBe(5);
  });

  it('estampille — sans jamais le supprimer — un workflow que n8n ne connaît plus', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const n8n = fakeN8n(workflows);
    const service = makeService(n8n, bus, estimates);
    await service.syncInstance(instanceId);

    workflows.length = 0; // supprimé côté n8n
    const report = await service.syncInstance(instanceId);

    expect(report.missing).toBe(1);
    // Redemandé à l'unité avant d'être déclaré absent : un archivé natif sort de
    // la liste sans avoir disparu.
    expect(n8n.fetched).toContain('1');
    const stored = await prisma.workflow.findFirstOrThrow();
    expect(stored.missingUpstreamAt).toBeInstanceOf(Date);
    expect(stored.name).toBe('Facturation');
  });

  it('ne redate pas l’estampille d’un workflow déjà absent', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const service = makeService(fakeN8n(workflows), bus, estimates);
    await service.syncInstance(instanceId);
    workflows.length = 0;
    await service.syncInstance(instanceId);
    const first = (await prisma.workflow.findFirstOrThrow()).missingUpstreamAt;

    await service.syncInstance(instanceId);

    const second = (await prisma.workflow.findFirstOrThrow()).missingUpstreamAt;
    // La date dit DEPUIS QUAND : la réécrire à chaque passe la vide de son sens.
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it('lève l’estampille dès que n8n reconnaît de nouveau le workflow', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const service = makeService(fakeN8n(workflows), bus, estimates);
    await service.syncInstance(instanceId);
    workflows.length = 0;
    await service.syncInstance(instanceId);
    expect((await prisma.workflow.findFirstOrThrow()).missingUpstreamAt).not.toBeNull();

    workflows.push(n8nWorkflow('1', 'Facturation'));
    await service.syncInstance(instanceId);

    expect((await prisma.workflow.findFirstOrThrow()).missingUpstreamAt).toBeNull();
  });

  it('resynchronise un workflow à l’unité et le marque absent sur un 404', async () => {
    const instanceId = await makeInstance();
    const workflows = [n8nWorkflow('1', 'Facturation')];
    const n8n = fakeN8n(workflows);
    const service = makeService(n8n, bus, estimates);
    await service.syncInstance(instanceId);
    const stored = await prisma.workflow.findFirstOrThrow();

    workflows.length = 0;
    const report = await service.syncWorkflow(stored.id);

    expect(report).toMatchObject({ name: 'Facturation', changed: false, missing: true });
    expect((await prisma.workflow.findFirstOrThrow()).missingUpstreamAt).toBeInstanceOf(Date);
  });
});
