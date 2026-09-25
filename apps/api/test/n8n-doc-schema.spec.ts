import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiPort, N8nWorkflow } from '@nwm/core';
import { DocSchemaService } from '../src/modules/doc-schema/doc-schema.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { recordingBus } from './helpers/fakes';
import { resetDb, testPrisma } from './helpers/db';

/** Le résumé IA d'un workflow n8n ne montre au fournisseur aucun secret saisi en dur. */

const prisma = testPrisma() as unknown as PrismaService;

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

const raw: N8nWorkflow = {
  id: 'wf1',
  name: 'Sync CRM',
  nodes: [
    {
      id: 'n1',
      name: 'Appeler le CRM',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4,
      position: [0, 0],
      parameters: {
        url: 'https://crm.test/contacts',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Authorization', value: `Bearer ${SECRET}` }] },
      },
    },
  ],
  connections: {},
} as N8nWorkflow;

async function seedWorkflow(): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name: 'n8n', baseUrl: 'https://n8n.test', apiKey: 'k' },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: 'wf1',
      name: 'Sync CRM',
      active: true,
      tags: [],
      hash: 'h',
      raw: raw as object,
    },
  });
  return workflow.id;
}

describe('documentation d un workflow n8n', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('masque les secrets des paramètres dans le prompt envoyé à l IA', async () => {
    const workflowId = await seedWorkflow();
    const prompts: string[] = [];
    const ai = {
      isConfigured: async () => true,
      generate: (async (params: { prompt: string }) => {
        prompts.push(params.prompt);
        return 'résumé';
      }) as AiPort['generate'],
    } as AiPort;
    const settings = {
      declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
    } as unknown as PlatformSettingsService;
    const workflows = new WorkflowsService(prisma, settings, {} as WorkflowSyncService);
    const service = new DocSchemaService(prisma, recordingBus() as unknown as EventBusService, workflows, ai);

    const doc = await service.generate(workflowId, true);

    expect(doc.summary).toBe('résumé');
    expect(prompts[0]).not.toContain(SECRET);
    expect(prompts[0]).toContain('https://crm.test/contacts');
  });
});
