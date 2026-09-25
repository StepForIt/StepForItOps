import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiAgentParams,
  AiPort,
  DocsPort,
  MAKE_CAPABILITIES,
  MakeBlueprint,
  N8nApiPort,
  WorkflowPlatformPort,
  flattenModules,
  hashContent,
} from '@nwm/core';
import { MakeChatTurnService } from '../src/modules/workflow-chat/make-chat-turn.service';
import { MakeProposalService } from '../src/modules/workflow-chat/make-proposal.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { RestorePointService } from '../src/modules/workflow-chat/restore-point.service';
import { ChatMemoryService } from '../src/modules/workflow-chat/chat-memory.service';
import { ChatHistoryService } from '../src/modules/workflow-chat/chat-history.service';
import { ChatProgressService } from '../src/modules/workflow-chat/chat-progress.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { EnvChainGuardService } from '../src/infra/settings/env-chain-guard.service';
import { WorkflowLockService } from '../src/infra/workflow-lock/workflow-lock.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * L'assistant sur un scénario Make, contre une vraie base.
 *
 * Ce qui se tient ici, c'est ce que la plateforme promet autour du modèle : une
 * proposition n'arrive à l'écran qu'après avoir passé la porte — refusée, elle
 * repart au modèle dans le même tour —, un secret masqué n'est jamais réécrit,
 * et l'écriture repart du scénario tel que Make le sert, par le port Make.
 */

const prisma = testPrisma() as unknown as PrismaService;

const blueprint: MakeBlueprint = {
  name: 'Sync CRM',
  flow: [
    {
      id: 1,
      module: 'http:ActionSendData',
      parameters: { __IMTCONN__: 42 },
      mapper: {
        url: 'https://crm.test/contacts',
        headers: [{ name: 'Authorization', value: 'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }],
      },
      metadata: { designer: { x: 0, y: 0 } },
    },
    {
      id: 2,
      module: 'google-sheets:addRow',
      mapper: { email: '{{1.email}}' },
      metadata: { designer: { x: 300, y: 0 } },
    },
  ],
  metadata: {},
};

const envelope = (reply: string, proposal: unknown = null) => JSON.stringify({ reply, proposal });

interface World {
  answers: string[];
  calls: AiAgentParams[];
  writes: unknown[];
  synced: number;
  /** Ce que Make sert au moment de la relecture ; modifiable pour simuler une édition dans Make. */
  current: unknown;
}

function build(world: World) {
  const port = {
    platform: 'make',
    capabilities: () => MAKE_CAPABILITIES,
    async updateWorkflow(_instance: unknown, _externalId: string, raw: unknown) {
      world.writes.push(raw);
    },
  } as unknown as WorkflowPlatformPort;
  const instances = new InstancesService(prisma, {} as N8nApiPort, { make: port });
  const sync = {
    // La relecture de Make : réécrit la copie locale et son empreinte, comme la vraie synchro.
    async syncWorkflow(id: string) {
      world.synced += 1;
      const before = await prisma.workflow.findUniqueOrThrow({ where: { id } });
      const hash = hashContent(world.current);
      await prisma.workflow.update({ where: { id }, data: { raw: world.current as object, hash } });
      return { name: before.name, changed: hash !== before.hash, missing: false };
    },
  } as unknown as WorkflowSyncService;
  const settings = {
    declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
  } as unknown as PlatformSettingsService;
  const workflows = new WorkflowsService(prisma, settings, sync);
  const envChain = { async assertDirectWriteAllowed() {} } as unknown as EnvChainGuardService;
  const proposals = new MakeProposalService(
    prisma,
    workflows,
    sync,
    instances,
    new RestorePointService(prisma, { isEnabled: async () => false } as never),
    envChain,
    settings,
    new WorkflowLockService(prisma),
  );
  const ai = {
    async chatWithTools(params: AiAgentParams) {
      world.calls.push(params);
      const text = world.answers.shift();
      if (text === undefined) throw new Error(`Appel IA #${world.calls.length} non prévu par le test`);
      return { text, trace: [], thinking: [] };
    },
  } as unknown as AiPort;
  const noop = () => undefined;
  const turn = new MakeChatTurnService(
    prisma,
    workflows,
    proposals,
    { brief: async () => null, remember: async () => ({ stored: true }) } as unknown as ChatMemoryService,
    { list: async () => [], read: async () => '' } as unknown as ChatHistoryService,
    { step: noop, fail: noop } as unknown as ChatProgressService,
    ai,
    { searchLibraries: async () => [], readDocs: async () => null } as unknown as DocsPort,
  );
  return { turn, proposals };
}

async function seed(): Promise<{ workflowId: string; sessionId: string }> {
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
      hash: hashContent(blueprint),
      raw: blueprint as object,
    },
  });
  const session = await prisma.workflowChatSession.create({ data: { workflowId: workflow.id, title: 'x' } });
  return { workflowId: workflow.id, sessionId: session.id };
}

const ask = (turn: MakeChatTurnService, ids: { workflowId: string; sessionId: string }) =>
  turn.answer({ ...ids, history: [{ role: 'user', content: 'une demande' }] });

describe('assistant sur un scénario Make', () => {
  let world: World;
  let ids: { workflowId: string; sessionId: string };

  beforeEach(async () => {
    await resetDb();
    world = { answers: [], calls: [], writes: [], synced: 0, current: blueprint };
    ids = await seed();
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('répond sans proposition, sur un contexte qui dit les liens et tait les secrets', async () => {
    world.answers = [envelope('Le module 1 appelle le CRM, le module 2 écrit la ligne.')];

    const result = await ask(build(world).turn, ids);

    expect(result.proposalId).toBeNull();
    expect(result.reply).toMatch(/CRM/);
    const context = String(world.calls[0].messages[0].content);
    expect(context).toContain('"links":[{"from":1,"to":2}]');
    expect(context).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(world.calls[0].tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['read_module', 'check_scenario']),
    );
  });

  it('enregistre une proposition qui passe la porte, avec le blueprint candidat', async () => {
    world.answers = [
      envelope('Je nomme le module.', {
        summary: 'Nommer le module 1',
        operations: [{ type: 'rename-module', moduleId: 1, name: 'Lire les contacts' }],
      }),
    ];

    const result = await ask(build(world).turn, ids);

    const proposal = await prisma.workflowChatProposal.findUniqueOrThrow({
      where: { id: result.proposalId! },
    });
    const candidate = proposal.raw as unknown as MakeBlueprint;
    expect(flattenModules(candidate).find((f) => f.module.id === 1)?.module.metadata?.designer?.name).toBe(
      'Lire les contacts',
    );
    expect(proposal.baseHash).toBe(hashContent(blueprint));
    expect(world.calls).toHaveLength(1);
  });

  it('renvoie au modèle, dans le même tour, une proposition que la porte refuse', async () => {
    world.answers = [
      // Supprimer le module 1 casse le module 2, qui lit {{1.email}}.
      envelope('Je retire l’appel.', {
        summary: 'Retirer',
        operations: [{ type: 'remove-module', moduleId: 1 }],
      }),
      envelope('Corrigé : je retire seulement l’en-tête.', {
        summary: 'Retirer l’en-tête',
        operations: [{ type: 'remove-module-field', moduleId: 1, section: 'mapper', path: 'headers.0' }],
      }),
    ];

    const result = await ask(build(world).turn, ids);

    expect(world.calls).toHaveLength(2);
    expect(String(world.calls[1].messages.at(-1)?.content)).toMatch(/^STOP/);
    expect(result.proposalId).not.toBeNull();
    expect(result.reply).toMatch(/corrigée et revérifiée/);
  });

  it('abandonne sans rien proposer quand le modèle recopie un secret masqué et renonce', async () => {
    world.answers = [
      envelope('Je change l’en-tête.', {
        summary: 'En-tête',
        operations: [
          {
            type: 'set-module-mapper',
            moduleId: 1,
            mapper: { headers: [{ name: 'Authorization', value: '[secret masqué sk-…]' }] },
          },
        ],
      }),
      envelope('Je ne peux pas réécrire ce secret : change-le dans Make.'),
    ];

    const result = await ask(build(world).turn, ids);

    expect(String(world.calls[1].messages.at(-1)?.content)).toMatch(/valeur masquée/);
    expect(result.proposalId).toBeNull();
    expect(await prisma.workflowChatProposal.count()).toBe(0);
  });

  it('écrit la proposition par le port Make après avoir relu le scénario, puis resynchronise', async () => {
    world.answers = [
      envelope('Je nomme le module.', {
        summary: 'Nommer',
        operations: [{ type: 'rename-module', moduleId: 2, name: 'Ajouter la ligne' }],
      }),
    ];
    const { turn, proposals } = build(world);
    const { proposalId } = await ask(turn, ids);
    const proposal = await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposalId! } });
    world.synced = 0;

    const result = await proposals.apply(proposal, false);

    expect(result.ok).toBe(true);
    expect(world.writes).toHaveLength(1);
    expect(
      flattenModules(world.writes[0] as MakeBlueprint).find((f) => f.module.id === 2)?.module.mapper,
    ).toEqual({
      email: '{{1.email}}',
    });
    // Une relecture avant d'écrire (empreinte), une après (nouvelle version).
    expect(world.synced).toBe(2);
    expect((await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposalId! } })).status).toBe(
      'applied',
    );
  });

  it('refuse d écrire sur un scénario modifié dans Make depuis la proposition', async () => {
    world.answers = [
      envelope('Je nomme.', {
        summary: 'Nommer',
        operations: [{ type: 'rename-module', moduleId: 2, name: 'X' }],
      }),
    ];
    const { turn, proposals } = build(world);
    const { proposalId } = await ask(turn, ids);
    const proposal = await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposalId! } });
    world.current = { ...blueprint, name: 'Sync CRM (édité dans Make)' };

    await expect(proposals.apply(proposal, false)).rejects.toThrow(/a changé dans Make/);
    expect(world.writes).toEqual([]);
  });

  it('relit une proposition Make dans la revue commune : plateforme, diff par module, porte', async () => {
    world.answers = [
      envelope('Je nomme.', {
        summary: 'Nommer',
        operations: [{ type: 'rename-module', moduleId: 1, name: 'Lire les contacts' }],
      }),
    ];
    const { turn, proposals } = build(world);
    const { proposalId } = await ask(turn, ids);
    const proposal = await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposalId! } });

    const review = await proposals.review(proposal);

    expect(review.platform).toBe('make');
    expect(review.diff.counts).toMatchObject({ renamed: 1 });
    expect(review.stale).toBe(false);
    expect(review.gate.blocked).toBe(false);
  });
});
