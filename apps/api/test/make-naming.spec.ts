import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiPort,
  MAKE_CAPABILITIES,
  MakeBlueprint,
  N8nApiPort,
  WorkflowPlatformPort,
  WorkflowPlatformPorts,
  flattenModules,
} from '@nwm/core';
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

/**
 * Le naming d'un scénario Make, contre une vraie base.
 *
 * Ce qui se tient ici : les modules sans nom deviennent des findings sous les
 * codes du naming n8n ; l'IA ne peut renommer qu'un module qui existe, et ne voit
 * jamais un secret ; l'écriture repart du scénario tel que Make le sert, désigne
 * chaque module par son id, et ne touche à aucune expression.
 */

const prisma = testPrisma() as unknown as PrismaService;

const blueprint: MakeBlueprint = {
  name: 'Sync CRM',
  flow: [
    {
      id: 1,
      module: 'http:ActionSendData',
      mapper: {
        url: 'https://crm.test/contacts',
        headers: [{ name: 'Authorization', value: 'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }],
      },
      metadata: { designer: { x: 0, y: 0 } },
    },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      metadata: { designer: { x: 300, y: 0, name: 'Aiguillage' } },
      routes: [
        {
          flow: [
            {
              id: 3,
              module: 'google-sheets:addRow',
              mapper: { email: '{{1.email}}' },
              metadata: { designer: { x: 600, y: 0 } },
            },
          ],
        },
      ],
    },
  ],
  metadata: {},
};

type RecordingPort = WorkflowPlatformPort & { writes: unknown[] };

function makePort(): RecordingPort {
  const writes: unknown[] = [];
  return {
    platform: 'make',
    writes,
    capabilities: () => MAKE_CAPABILITIES,
    async updateWorkflow(_instance: unknown, _externalId: string, raw: unknown) {
      writes.push(raw);
    },
  } as unknown as RecordingPort;
}

function build(opts: { port: RecordingPort; ai?: Partial<AiPort>; synced?: string[] }) {
  const ports: WorkflowPlatformPorts = { make: opts.port };
  const instances = new InstancesService(prisma, {} as N8nApiPort, ports);
  const sync = {
    async syncWorkflow(id: string) {
      opts.synced?.push(id);
      return { name: 'Sync CRM', changed: false, missing: false };
    },
  } as unknown as WorkflowSyncService;
  const settings = {
    declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
  } as unknown as PlatformSettingsService;
  const workflows = new WorkflowsService(prisma, settings, sync);
  const envChain = { async assertDirectWriteAllowed() {} } as unknown as EnvChainGuardService;
  const locks = new WorkflowLockService(prisma);
  const bus = recordingBus() as unknown as EventBusService;
  const ai = { isConfigured: async () => true, ...opts.ai } as AiPort;
  const makeNaming = new MakeNamingService(bus, workflows, sync, instances, envChain, ai, locks);
  const ignores = {
    async filterIgnored<T>(_workflowId: string, _module: string, found: T[]) {
      return { kept: found, ignored: [] };
    },
  } as unknown as FindingIgnoreService;
  const profiles = { effective: async () => [] } as unknown as CheckProfilesService;
  return new OptimizerService(
    prisma,
    bus,
    workflows,
    sync,
    ignores,
    profiles,
    instances,
    envChain,
    makeNaming,
    ai,
    {} as N8nApiPort,
    locks,
  );
}

async function seedScenario(): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name: 'Make', baseUrl: 'eu1.make.com', apiKey: 'k', platform: 'make', zone: 'eu1.make.com' },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: '4210',
      name: 'Sync CRM',
      active: true,
      tags: [],
      hash: 'h',
      raw: blueprint as object,
    },
  });
  return workflow.id;
}

const nameOf = (raw: unknown, id: number) =>
  flattenModules(raw as MakeBlueprint).find((flat) => flat.module.id === id)?.module.metadata?.designer?.name;

describe('naming d un scénario Make', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('persiste un finding default-name par module sans nom, routes comprises', async () => {
    const workflowId = await seedScenario();

    const findings = await build({ port: makePort() }).analyze(workflowId);

    expect(
      findings
        .filter((f) => f.code === 'default-name')
        .map((f) => (f.data as { moduleId: number }).moduleId)
        .sort(),
    ).toEqual([1, 3]);
  });

  it('ne garde que les propositions de l IA sur des modules existants, sans lui montrer de secret', async () => {
    const workflowId = await seedScenario();
    const prompts: string[] = [];
    const ai: Partial<AiPort> = {
      generateJson: (async (params: { prompt: string }) => {
        prompts.push(params.prompt);
        return [
          { moduleId: 1, newName: 'Fetch CRM contacts', reason: 'appel au CRM' },
          { moduleId: 99, newName: 'Inventé', reason: '?' },
        ];
      }) as AiPort['generateJson'],
    };

    const suggestions = await build({ port: makePort(), ai }).suggestNames(workflowId);

    expect(suggestions).toEqual([
      { moduleId: 1, oldName: 'http:ActionSendData', newName: 'Fetch CRM contacts', reason: 'appel au CRM' },
    ]);
    expect(prompts[0]).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(JSON.parse(prompts[0]).map((m: { moduleId: number }) => m.moduleId)).toEqual([1, 3]);
  });

  it('écrit les noms par id après avoir relu Make, sans toucher aux expressions, puis resynchronise', async () => {
    const workflowId = await seedScenario();
    const port = makePort();
    const synced: string[] = [];

    const result = await build({ port, synced }).applyRenames(workflowId, [
      { moduleId: 3, oldName: 'google-sheets:addRow', newName: 'Ajouter la ligne' },
    ]);

    expect(result).toEqual({ renamed: 1 });
    expect(port.writes).toHaveLength(1);
    expect(nameOf(port.writes[0], 3)).toBe('Ajouter la ligne');
    expect(nameOf(port.writes[0], 2)).toBe('Aiguillage');
    expect(
      flattenModules(port.writes[0] as MakeBlueprint).find((f) => f.module.id === 3)?.module.mapper,
    ).toEqual({
      email: '{{1.email}}',
    });
    // Une fois avant d'écrire (repartir de Make), une fois après (resnapshot).
    expect(synced).toEqual([workflowId, workflowId]);
  });

  it('refuse un renommage sans id de module, et un id que le scénario n a plus, sans rien écrire', async () => {
    const workflowId = await seedScenario();
    const port = makePort();
    const service = build({ port });

    await expect(
      service.applyRenames(workflowId, [{ oldName: 'http:ActionSendData', newName: 'X' }]),
    ).rejects.toThrow(/par son id/);
    await expect(
      service.applyRenames(workflowId, [{ moduleId: 99, oldName: '?', newName: 'X' }]),
    ).rejects.toThrow(/#99/);
    expect(port.writes).toEqual([]);
  });
});
