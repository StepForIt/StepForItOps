import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiPort, N8nApiPort, N8nWorkflow, WorkflowPlatformPorts } from '@nwm/core';
import { OptimizerService } from '../src/modules/optimizer/optimizer.service';
import { MakeNamingService } from '../src/modules/optimizer/make-naming.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { FindingIgnoreService } from '../src/modules/workflows/finding-ignore.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { EnvChainGuardService } from '../src/infra/settings/env-chain-guard.service';
import { CheckProfilesService } from '../src/infra/check-profiles/check-profiles.service';
import { recordingBus } from './helpers/fakes';
import { WorkflowLockService } from '../src/infra/workflow-lock/workflow-lock.service';
import { resetDb, testPrisma } from './helpers/db';

/** Les suggestions de noms d'un workflow n8n ne montrent au fournisseur d'IA aucun secret saisi en dur. */

const prisma = testPrisma() as unknown as PrismaService;

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

const raw: N8nWorkflow = {
  id: 'wf1',
  name: 'Sync CRM',
  nodes: [
    {
      id: 'n1',
      name: 'HTTP Request',
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

function build(ai: AiPort) {
  const ports: WorkflowPlatformPorts = {};
  const instances = new InstancesService(prisma, {} as N8nApiPort, ports);
  const sync = {} as WorkflowSyncService;
  const settings = {
    declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
  } as unknown as PlatformSettingsService;
  const workflows = new WorkflowsService(prisma, settings, sync);
  const envChain = {} as EnvChainGuardService;
  const locks = new WorkflowLockService(prisma);
  const bus = recordingBus() as unknown as EventBusService;
  const makeNaming = new MakeNamingService(bus, workflows, sync, instances, envChain, ai, locks);
  return new OptimizerService(
    prisma,
    bus,
    workflows,
    sync,
    {} as FindingIgnoreService,
    {} as CheckProfilesService,
    instances,
    envChain,
    makeNaming,
    ai,
    {} as N8nApiPort,
    locks,
  );
}

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

describe('naming d un workflow n8n', () => {
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
      generateJson: (async (params: { prompt: string }) => {
        prompts.push(params.prompt);
        return [{ oldName: 'HTTP Request', newName: 'Fetch CRM contacts', note: 'n', reason: 'r' }];
      }) as AiPort['generateJson'],
    } as AiPort;

    const suggestions = await build(ai).suggestNames(workflowId);

    expect(suggestions.map((s) => s.newName)).toEqual(['Fetch CRM contacts']);
    expect(prompts[0]).not.toContain(SECRET);
    expect(prompts[0]).toContain('https://crm.test/contacts');
  });
});
