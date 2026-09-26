import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiGenerateParams, AiPort } from '@nwm/core';
import { DocSchemaService } from '../src/modules/doc-schema/doc-schema.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { RecordingBus, recordingBus } from './helpers/fakes';
import { n8nWorkflow } from './helpers/workflow-fixtures';
import { resetDb, testPrisma } from './helpers/db';

/**
 * La documentation générée d'un scénario Make, contre une vraie base.
 *
 * Ce qui se tient ici : le schéma et le résumé se lisent sur l'imbrication du
 * blueprint — les liens partent explicites vers l'IA, sans secret —, la doc est
 * persistée comme celle d'un workflow n8n, et le chemin n8n ne bouge pas.
 */

const prisma = testPrisma() as unknown as PrismaService;

const blueprint = {
  name: 'Sync CRM',
  flow: [
    {
      id: 1,
      module: 'gateway:CustomWebHook',
      parameters: { apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' },
      metadata: { designer: { name: 'Réception commande' } },
    },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [
        { flow: [{ id: 3, module: 'google-sheets:addRow', metadata: { designer: { name: 'Archiver' } } }] },
      ],
    },
  ],
  metadata: {},
};

function service(ai: Partial<AiPort>, bus: RecordingBus): DocSchemaService {
  const settings = {
    declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
  } as unknown as PlatformSettingsService;
  const workflows = new WorkflowsService(prisma, settings, {} as WorkflowSyncService);
  return new DocSchemaService(prisma, bus as unknown as EventBusService, workflows, {
    isConfigured: async () => true,
    ...ai,
  } as AiPort);
}

async function seed(platform: 'n8n' | 'make', raw: unknown): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name: platform, baseUrl: 'http://127.0.0.1:0', apiKey: 'k', platform },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: '42',
      name: 'Sync CRM',
      active: false,
      tags: [],
      hash: 'h',
      raw: raw as object,
    },
  });
  return workflow.id;
}

describe('documentation générée d un scénario Make', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('dessine les modules et persiste la doc, résumé compris', async () => {
    const workflowId = await seed('make', blueprint);
    const bus = recordingBus();

    const doc = await service({ generate: async () => '**But** : synchroniser le CRM' }, bus).generate(
      workflowId,
      true,
    );

    expect(doc.mermaid).toContain('Réception commande');
    expect(doc.mermaid).toContain('Archiver');
    expect(doc.summary).toBe('**But** : synchroniser le CRM');
    expect(await prisma.workflowDoc.findUnique({ where: { workflowId } })).toMatchObject({
      summary: doc.summary,
    });
    expect(bus.emitted.map((event) => event.name)).toEqual(['doc.generated']);
  });

  it('donne à l IA les liens explicites et jamais un secret', async () => {
    const workflowId = await seed('make', blueprint);
    const requests: AiGenerateParams[] = [];

    await service(
      {
        generate: async (params: AiGenerateParams) => {
          requests.push(params);
          return 'ok';
        },
      },
      recordingBus(),
    ).generate(workflowId, true);

    const context = JSON.parse(requests[0].prompt);
    expect(requests[0].system).toMatch(/Make scenario/);
    expect(context.links).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3, label: 'route 1' },
    ]);
    expect(requests[0].prompt).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  });

  it('garde le chemin n8n : nœuds et connexions, prompt n8n', async () => {
    const workflowId = await seed('n8n', n8nWorkflow('42', 'Sync CRM'));
    const requests: AiGenerateParams[] = [];

    const doc = await service(
      {
        generate: async (params: AiGenerateParams) => {
          requests.push(params);
          return 'ok';
        },
      },
      recordingBus(),
    ).generate(workflowId, true);

    expect(doc.mermaid).toContain('Déclencheur');
    expect(requests[0].system).toMatch(/n8n workflow/);
    expect(JSON.parse(requests[0].prompt)).toHaveProperty('connections');
  });
});
