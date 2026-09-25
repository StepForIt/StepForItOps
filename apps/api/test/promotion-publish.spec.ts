import { beforeEach, describe, expect, it } from 'vitest';
import { N8nApiError, N8nApiPort, N8nWorkflow } from '@nwm/core';
import { PromotionPublishService } from '../src/modules/env-switcher/promotion-publish.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import {
  WorkflowLockService,
  WorkflowLockedException,
} from '../src/infra/workflow-lock/workflow-lock.service';
import { runWithLockContext } from '../src/infra/workflow-lock/lock-context';
import { resetDb, testPrisma } from './helpers/db';

/**
 * La chaîne « publier comme la source », sur le cas qui l'a fait naître :
 * « Create Product From Airtable » appelle « Create product and collection », qui
 * appelle « Create collection ». Sur la cible, rien n'est publié.
 */

const prisma = testPrisma() as unknown as PrismaService;

const subTrigger = {
  id: 't',
  name: 'When Executed by Another Workflow',
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  position: [0, 0],
  parameters: {},
};
const call = (target: string) => ({
  id: `c-${target}`,
  name: 'Appel',
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  position: [0, 0],
  parameters: { workflowId: { __rl: true, mode: 'list', value: target } },
});

const wf = (id: string, name: string, callee: string | null, published: boolean): N8nWorkflow =>
  ({
    id,
    name,
    nodes: [subTrigger, ...(callee ? [call(callee)] : [])],
    connections: {},
    activeVersionId: published ? `v-${id}` : null,
  }) as N8nWorkflow;

interface Fixture {
  service: PromotionPublishService;
  sourceWorkflowId: string;
  prodId: string;
  /** Workflows servis par n8n, par instance puis par id. */
  n8n: Record<string, Map<string, N8nWorkflow>>;
  /** Ids que n8n refusera de publier, avec le message qu'il rend. */
  refuse: Map<string, string>;
  published: string[];
}

async function setup(
  sourcePublished: { root?: boolean; mid?: boolean; leaf?: boolean } = {},
): Promise<Fixture> {
  const dev = await prisma.instance.create({ data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' } });
  const prod = await prisma.instance.create({ data: { name: 'Prod', baseUrl: 'http://prod', apiKey: 'k' } });
  const source = wf('1', 'Create Product From Airtable', '2', sourcePublished.root ?? true);
  const devWorkflows = new Map<string, N8nWorkflow>([
    ['1', source],
    ['2', wf('2', 'Create product and collection', '3', sourcePublished.mid ?? true)],
    ['3', wf('3', 'Create collection', null, sourcePublished.leaf ?? true)],
  ]);
  const prodWorkflows = new Map<string, N8nWorkflow>([
    ['10', wf('10', 'Create Product From Airtable - PROD', '20', false)],
    ['20', wf('20', 'Create product and collection - PROD', '30', false)],
    ['30', wf('30', 'Create collection - PROD', null, false)],
  ]);
  const row = await prisma.workflow.create({
    data: {
      instanceId: dev.id,
      externalId: '1',
      name: source.name,
      active: true,
      tags: [],
      hash: 'h',
      raw: {},
    },
  });
  for (const [externalId, workflow] of prodWorkflows) {
    await prisma.workflow.create({
      data: {
        instanceId: prod.id,
        externalId,
        name: workflow.name,
        active: false,
        tags: [],
        hash: 'h',
        raw: {},
      },
    });
  }

  const byUrl = (config: { baseUrl: string }) =>
    fixture.n8n[config.baseUrl === 'http://dev' ? 'dev' : 'prod'];
  const n8n = {
    async getWorkflow(config: { baseUrl: string }, id: string) {
      const workflow = byUrl(config).get(id);
      if (!workflow) throw new N8nApiError(`n8n API GET /workflows/${id} → 404: not found`, 404);
      return structuredClone(workflow);
    },
    async publishWorkflow(config: { baseUrl: string }, id: string) {
      const refusal = fixture.refuse.get(id);
      if (refusal) throw new N8nApiError(`n8n API POST /workflows/${id}/publish → 400: ${refusal}`, 400);
      byUrl(config).get(id)!.activeVersionId = `v-${id}`;
      fixture.published.push(id);
    },
  } as unknown as N8nApiPort;
  const instances = {
    async getConfig(id: string) {
      return { baseUrl: id === dev.id ? 'http://dev' : 'http://prod', apiKey: 'k' };
    },
  } as unknown as InstancesService;
  const sync = { async upsertWorkflow() {} } as unknown as WorkflowSyncService;

  const fixture: Fixture = {
    service: new PromotionPublishService(prisma, sync, instances, n8n, new WorkflowLockService(prisma)),
    sourceWorkflowId: row.id,
    prodId: prod.id,
    n8n: { dev: devWorkflows, prod: prodWorkflows },
    refuse: new Map(),
    published: [],
  };
  return fixture;
}

const start = (fixture: Fixture) =>
  fixture.service.start(fixture.sourceWorkflowId, [
    { instanceId: fixture.prodId, env: 'prod', targetN8nId: '10' },
  ]);

describe('PromotionPublishService', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('publie les appelés d’abord, sur trois niveaux', async () => {
    const fixture = await setup();

    const run = await start(fixture);

    expect(fixture.published).toEqual(['30', '20', '10']);
    expect(run.status).toBe('done');
    expect(run.steps.map((step) => [step.name, step.state])).toEqual([
      ['Create collection - PROD', 'done'],
      ['Create product and collection - PROD', 'done'],
      ['Create Product From Airtable - PROD', 'done'],
    ]);
  });

  it('laisse en brouillon ce qui l’est dans la source', async () => {
    const fixture = await setup({ leaf: false });

    const run = await start(fixture);

    expect(run.steps[0].state).toBe('kept-draft');
    expect(fixture.published).not.toContain('30');
  });

  it('se met en pause au premier refus, sans toucher aux appelants', async () => {
    const fixture = await setup();
    fixture.refuse.set('20', 'Please publish all referenced sub-workflows first');

    const run = await start(fixture);

    expect(run.status).toBe('paused');
    expect(fixture.published).toEqual(['30']);
    expect(run.steps.map((step) => step.state)).toEqual(['done', 'failed', 'pending']);
    expect(run.steps[1].reason).toContain('Please publish all referenced sub-workflows first');
    expect((await fixture.service.find(fixture.sourceWorkflowId))?.id).toBe(run.id);
  });

  it('reprend là où elle s’était arrêtée, une fois la cause corrigée', async () => {
    const fixture = await setup();
    fixture.refuse.set('20', 'refus');
    const paused = await start(fixture);
    fixture.refuse.clear();

    const run = await fixture.service.resume(paused.id);

    expect(run.status).toBe('done');
    expect(fixture.published).toEqual(['30', '20', '10']);
    expect(await fixture.service.find(fixture.sourceWorkflowId)).toBeNull();
  });

  it('ne republie pas ce qu’un humain a publié pendant la pause', async () => {
    const fixture = await setup();
    fixture.refuse.set('20', 'refus');
    const paused = await start(fixture);
    fixture.n8n.prod.get('20')!.activeVersionId = 'v-main';

    const run = await fixture.service.resume(paused.id);

    expect(run.steps[1].state).toBe('already');
    expect(fixture.published).toEqual(['30', '10']);
  });

  it('passe l’étape refusée et continue avec la suite', async () => {
    const fixture = await setup();
    fixture.refuse.set('30', 'refus');
    const paused = await start(fixture);

    const run = await fixture.service.skip(paused.id);

    expect(run.steps.map((step) => step.state)).toEqual(['skipped', 'done', 'done']);
    expect(run.status).toBe('done');
  });

  it('abandonnée, elle ne se reprend plus', async () => {
    const fixture = await setup();
    fixture.refuse.set('30', 'refus');
    const paused = await start(fixture);

    const run = await fixture.service.abandon(paused.id);

    expect(run.status).toBe('abandoned');
    await expect(fixture.service.resume(paused.id)).rejects.toThrow(/pas en pause/);
  });

  it('s’arrête sur un exemplaire verrouillé, et ne le publie qu’avec un forçage qui le nomme', async () => {
    const fixture = await setup();
    const locked = await prisma.workflow.findFirstOrThrow({
      where: { instanceId: fixture.prodId, externalId: '30' },
    });
    await prisma.workflowLock.create({ data: { workflowId: locked.id } });

    const paused = await start(fixture);
    expect(paused.status).toBe('paused');
    expect(paused.steps[0].reason).toMatch(/verrouillé/);
    expect(fixture.published).toEqual([]);

    await expect(fixture.service.resume(paused.id)).rejects.toBeInstanceOf(WorkflowLockedException);

    const run = await runWithLockContext(
      { override: { workflowIds: [locked.id], reason: 'mise en prod validée' }, action: 'test' },
      () => fixture.service.resume(paused.id),
    );
    expect(run.status).toBe('done');
    expect(fixture.published).toEqual(['30', '20', '10']);
  });
});
