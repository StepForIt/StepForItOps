import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nWorkflow, hashContent } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { WorkflowDivergenceService } from '../src/modules/workflows/workflow-divergence.service';
import { WorkflowFamiliesService } from '../src/modules/workflows/workflow-families.service';
import { WorkflowDivergenceDetailService } from '../src/modules/workflows/workflow-divergence-detail.service';
import { resetDb, testPrisma } from './helpers/db';

const prisma = testPrisma() as unknown as PrismaService;

function airtable(base: string, method = 'POST'): N8nWorkflow {
  return {
    name: '',
    nodes: [
      {
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        parameters: { path: 'form', httpMethod: method },
      },
      {
        name: 'Airtable',
        type: 'n8n-nodes-base.airtable',
        parameters: { base: { __rl: true, value: base, mode: 'list' } },
      },
    ],
    connections: { Webhook: { main: [[{ node: 'Airtable', type: 'main', index: 0 }]] } },
  };
}

async function seed(instanceId: string, name: string, raw: N8nWorkflow, day: number, tags: string[] = []) {
  const content = { ...raw, name };
  return prisma.workflow.create({
    data: {
      instanceId,
      externalId: name,
      name,
      tags,
      hash: hashContent(content),
      raw: content as object,
      upstreamUpdatedAt: new Date(Date.UTC(2026, 8, day)),
    },
  });
}

function services() {
  const settings = new PlatformSettingsService(prisma);
  const workflows = new WorkflowsService(prisma, settings, {} as WorkflowSyncService);
  const divergence = new WorkflowDivergenceService(prisma, settings, workflows);
  const families = new WorkflowFamiliesService(workflows, settings, divergence);
  const detail = new WorkflowDivergenceDetailService(prisma, workflows, divergence);
  return { divergence, families, detail };
}

describe('WorkflowDivergenceService', () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma().$disconnect());

  it('compare dev et prod à ressources mappées près, et suit un mapping modifié', async () => {
    const dev = await prisma.instance.create({ data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' } });
    const prod = await prisma.instance.create({
      data: { name: 'Prod', baseUrl: 'http://prod', apiKey: 'k' },
    });
    const devWf = await seed(dev.id, 'Form - DEV', airtable('appDEV1234'), 3);
    await seed(prod.id, 'Form - PROD', airtable('appPROD123'), 2);
    const { divergence } = services();

    expect((await divergence.statuses()).get(devWf.id)?.status).toBe('ahead');

    await prisma.resourceMapping.create({
      data: {
        provider: 'airtable',
        logicalName: 'CRM',
        values: { dev: { baseId: 'appDEV1234' }, prod: { baseId: 'appPROD123' } },
      },
    });
    expect((await divergence.statuses()).get(devWf.id)?.status).toBe('in-sync');
  });

  it('filtre les familles à déployer sans perdre la prod d’une autre instance', async () => {
    const dev = await prisma.instance.create({ data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' } });
    const prod = await prisma.instance.create({
      data: { name: 'Prod', baseUrl: 'http://prod', apiKey: 'k' },
    });
    await seed(dev.id, 'A - DEV', airtable('appX1234', 'GET'), 3);
    await seed(prod.id, 'A - PROD', airtable('appX1234'), 2);
    await seed(dev.id, 'B - DEV', airtable('appX1234'), 3);
    await seed(prod.id, 'B - PROD', airtable('appX1234'), 2);
    await seed(dev.id, 'C - DEV', airtable('appX1234'), 3);
    const { families } = services();

    const { data } = await families.list({}, { instanceId: dev.id, divergence: 'dev' });
    expect(data.map((family) => family.name)).toEqual(['A', 'C']);
    expect(data[0].toDeploy).toEqual(['dev']);
    expect(data[0].members[0].divergence?.status).toBe('ahead');
    expect(data[1].members[0].divergence?.status).toBe('not-deployed');
  });

  it('une prod archivée n’est plus une référence', async () => {
    const instance = await prisma.instance.create({ data: { name: 'I', baseUrl: 'http://i', apiKey: 'k' } });
    const devWf = await seed(instance.id, 'A - DEV', airtable('appX1234'), 3);
    await seed(instance.id, 'A - PROD', airtable('appX1234'), 2, ['archived']);
    const { divergence } = services();

    expect((await divergence.statuses()).get(devWf.id)?.status).toBe('not-deployed');
  });

  describe('le détail de l’écart', () => {
    async function twoInstances() {
      const dev = await prisma.instance.create({ data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' } });
      const prod = await prisma.instance.create({
        data: { name: 'Prod', baseUrl: 'http://prod', apiKey: 'k' },
      });
      return { dev, prod };
    }

    it('montre le correctif fait en prod, dans le sens de la promotion', async () => {
      const { dev, prod } = await twoInstances();
      const devWf = await seed(dev.id, 'Form - DEV', airtable('appX1234'), 2);
      const prodWf = await seed(prod.id, 'Form - PROD', airtable('appX1234', 'GET'), 5);
      const { detail } = services();

      const result = await detail.detail(devWf.id);

      expect(result.status).toBe('behind');
      expect(result.workflow).toMatchObject({ id: devWf.id, env: 'dev', instanceName: 'Dev' });
      expect(result.reference).toMatchObject({ id: prodWf.id, env: 'prod', instanceName: 'Prod' });
      expect(result.diff.nodes).toHaveLength(1);
      expect(result.diff.nodes[0]).toMatchObject({ name: 'Webhook', change: 'modified' });
      // Avant = la prod telle qu'elle est ; après = ce que la promotion y poserait.
      const removed = result.diff.nodes[0].lines.filter((line) => line.type === 'del').map((l) => l.text);
      expect(removed.join('\n')).toContain('"GET"');
    });

    it('ne montre rien quand seule diffère une ressource mappée', async () => {
      const { dev, prod } = await twoInstances();
      const devWf = await seed(dev.id, 'Form - DEV', airtable('appDEV1234'), 3);
      await seed(prod.id, 'Form - PROD', airtable('appPROD123'), 2);
      await prisma.resourceMapping.create({
        data: {
          provider: 'airtable',
          logicalName: 'CRM',
          values: { dev: { baseId: 'appDEV1234' }, prod: { baseId: 'appPROD123' } },
        },
      });
      const { detail } = services();

      const result = await detail.detail(devWf.id);

      expect(result.status).toBe('in-sync');
      expect(result.diff.hasChanges).toBe(false);
    });

    it('refuse sans prod à laquelle comparer', async () => {
      const { dev } = await twoInstances();
      const devWf = await seed(dev.id, 'Seul - DEV', airtable('appX1234'), 3);
      const { detail } = services();

      await expect(detail.detail(devWf.id)).rejects.toThrow(/Aucun exemplaire en prod/);
    });

    it('refuse sur la prod elle-même', async () => {
      const { dev, prod } = await twoInstances();
      await seed(dev.id, 'Form - DEV', airtable('appX1234'), 3);
      const prodWf = await seed(prod.id, 'Form - PROD', airtable('appX1234'), 2);
      const { detail } = services();

      await expect(detail.detail(prodWf.id)).rejects.toThrow(/référence/);
    });
  });
});
