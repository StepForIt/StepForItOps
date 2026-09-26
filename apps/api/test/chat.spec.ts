import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiAgentParams, AiPort, DocsPort, N8nWorkflow } from '@nwm/core';
import { ChatService } from '../src/modules/workflow-chat/chat.service';
import { MakeChatTurnService } from '../src/modules/workflow-chat/make-chat-turn.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { ProposalService } from '../src/modules/workflow-chat/proposal.service';
import { InstanceCredentialsService } from '../src/modules/workflow-chat/instance-credentials.service';
import { ChatMemoryService } from '../src/modules/workflow-chat/chat-memory.service';
import { LessonRecallService } from '../src/modules/workflow-chat/lesson-recall.service';
import { ChatHistoryService } from '../src/modules/workflow-chat/chat-history.service';
import { InstanceShapesService } from '../src/modules/workflow-chat/instance-shapes.service';
import { NodeCatalogService } from '../src/infra/node-catalog/node-catalog.service';
import {
  NodePackageDocsService,
  PackageDocAnnounce,
} from '../src/infra/node-catalog/node-package-docs.service';
import { NodePackageDocsSyncService } from '../src/infra/node-catalog/node-package-docs-sync.service';
import { ChatProgressService } from '../src/modules/workflow-chat/chat-progress.service';
import { ChatCancelService } from '../src/modules/workflow-chat/chat-cancel.service';
import { DraftRepairService } from '../src/modules/workflow-chat/draft-repair.service';
import { ExampleCorpusService } from '../src/modules/workflow-chat/example-corpus.service';
import { ChatScopeService } from '../src/modules/workflow-chat/chat-scope.service';
import { WorkflowCreateService } from '../src/modules/workflows/workflow-create.service';
import { ChatLeftoversService } from '../src/modules/workflow-chat/chat-leftovers.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow, withEnv } from './helpers/workflow-fixtures';

/**
 * Le tour de conversation.
 *
 * Ce qui est tenu ici n'est pas la qualité du modèle mais ce que la plateforme
 * PROMET autour de lui : une demande n'est jamais perdue. Un appel qui échoue,
 * une réponse vide, une enveloppe illisible, un arrêt demandé par l'humain —
 * chacun a son sort, et ils ne se ressemblent pas : l'échec CONSERVE la demande
 * et l'annonce dans le fil, l'arrêt la DÉFAIT et la rend à la saisie.
 */

const prisma = testPrisma();

interface Fakes {
  /** Ce que le modèle répond, ou l'erreur qu'il lève. */
  reply: string | Error;
  cancelled: boolean;
  created: Array<{ summary: string; operations: unknown[] }>;
  gateReason?: string;
  /** Le tour d'un scénario Make ; absent, rien ne doit l'appeler. */
  makeTurn?: MakeChatTurnService;
  n8nCalls?: number;
  /** Ce que l'annonce des nœuds communautaires rend pour le workflow du tour. */
  community?: PackageDocAnnounce[];
  /** Paquets dont la lecture en arrière-plan a été demandée. */
  ensured?: string[];
  calls?: AiAgentParams[];
}

function makeService(fakes: Fakes, raw: N8nWorkflow): ChatService {
  const ai = {
    async chatWithTools(params: AiAgentParams) {
      (fakes.calls ??= []).push(params);
      if (fakes.reply instanceof Error) throw fakes.reply;
      fakes.n8nCalls = (fakes.n8nCalls ?? 0) + 1;
      return { text: fakes.reply, trace: [], thinking: [] };
    },
  } as unknown as AiPort;

  const workflows = {
    async getFreshRaw(id: string) {
      const row = await prisma.workflow.findUniqueOrThrow({ where: { id } });
      return { workflow: withEnv(row), raw, missing: false };
    },
  } as unknown as WorkflowsService;

  const proposals = {
    async create(_workflowId: string, _sessionId: string | null, summary: string, operations: unknown[]) {
      fakes.created.push({ summary, operations });
      const proposal = { id: `prop-${fakes.created.length}` };
      return {
        proposal,
        gate: { blocked: false, breaches: [], introduced: [], refusals: [], reason: fakes.gateReason },
      };
    },
  } as unknown as ProposalService;

  const repair = {
    // La passe de correction a sa suite de tests ; ici elle rend le brouillon tel quel.
    async repair(input: { draft: unknown }) {
      return { draft: input.draft, outcome: 'clean', reply: null, attempts: 0, trace: [], thinking: [] };
    },
  } as unknown as DraftRepairService;

  const cancels = {
    // Comme le vrai service : un arrêt AVORTE le signal porté jusqu'à l'appel
    // Anthropic, et se relit ensuite sur `wasCancelled`. Le signal seul ne
    // suffit pas — c'est lui qui fait remonter l'erreur, et le drapeau qui dit
    // qu'il s'agissait d'un arrêt et non d'une panne.
    open() {
      const controller = new AbortController();
      if (fakes.cancelled) controller.abort();
      return controller.signal;
    },
    wasCancelled() {
      return fakes.cancelled;
    },
    close() {},
  } as unknown as ChatCancelService;

  const noop = () => undefined;
  const progress = { start: noop, step: noop, fail: noop, finish: noop } as unknown as ChatProgressService;
  const memory = {
    async brief() {
      return null;
    },
    async remember() {},
  } as unknown as ChatMemoryService;
  const lessons = {
    async recall() {
      return [];
    },
    async answerPending() {},
  } as unknown as LessonRecallService;
  const history = {
    async list() {
      return [];
    },
    async read() {
      return null;
    },
  } as unknown as ChatHistoryService;
  const shapes = {
    async check() {
      return [];
    },
  } as unknown as InstanceShapesService;
  const nodeCatalog = {
    async check() {
      return [];
    },
    async describe() {
      return null;
    },
    async search() {
      return [];
    },
  } as unknown as NodeCatalogService;
  const examples = {
    async workflows() {
      return [];
    },
    async byName() {
      return null;
    },
  } as unknown as ExampleCorpusService;
  const scope = {
    async build() {
      return [];
    },
  } as unknown as ChatScopeService;
  const credentials = {
    async choicesFor() {
      return [];
    },
  } as unknown as InstanceCredentialsService;
  const workflowCreate = {} as unknown as WorkflowCreateService;
  const leftovers = {
    async record() {},
    async list() {
      return [];
    },
  } as unknown as ChatLeftoversService;
  const docs = {
    async searchLibraries() {
      return [];
    },
    async readDocs() {
      return null;
    },
  } as unknown as DocsPort;

  const packageDocs = {
    async announce() {
      return fakes.community ?? [];
    },
    async read() {
      return null;
    },
  } as unknown as NodePackageDocsService;
  const packageDocsSync = {
    ensureInBackground(names: string[]) {
      (fakes.ensured ??= []).push(...names);
    },
  } as unknown as NodePackageDocsSyncService;
  return new ChatService(
    prisma as unknown as PrismaService,
    workflows,
    proposals,
    credentials,
    memory,
    lessons,
    history,
    shapes,
    nodeCatalog,
    progress,
    cancels,
    repair,
    examples,
    scope,
    workflowCreate,
    leftovers,
    fakes.makeTurn ?? ({} as MakeChatTurnService),
    packageDocs,
    packageDocsSync,
    ai,
    docs,
  );
}

/** L'enveloppe JSON attendue d'un tour. */
function envelope(reply: string, proposal: unknown = null): string {
  return JSON.stringify({ reply, proposal });
}

describe('ChatService — le tour', () => {
  let fakes: Fakes;
  let workflowId: string;
  let sessionId: string;
  const raw = n8nWorkflow('wf1', 'Facturation');

  beforeEach(async () => {
    await resetDb();
    fakes = { reply: envelope('Voici.'), cancelled: false, created: [] };
    const instanceId = await seedInstance(prisma);
    workflowId = await seedWorkflow(prisma, instanceId, raw);
    sessionId = (await prisma.workflowChatSession.create({ data: { workflowId, title: 'Nouvelle' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('ce qui n’atteint jamais le modèle', () => {
    it('refuse un message vide sans rien écrire', async () => {
      const service = makeService(fakes, raw);

      await expect(service.sendMessage(sessionId, '   ')).rejects.toThrow(/vide/i);
      expect(await prisma.workflowChatMessage.count()).toBe(0);
    });

    it('écrit une demande par défaut quand seul un fichier est joint', async () => {
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, '', {
        files: [{ name: 'export.json', mediaType: 'application/json', text: '{"a":1}' }],
      });

      // Une pièce jointe seule est une demande valable ; sans ce texte, la
      // conversation garderait un tour muet.
      expect(result.userMessage.content).toMatch(/fichiers joints/i);
      const attachments = await prisma.workflowChatAttachment.findMany();
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.name).toBe('export.json');
    });

    it('refuse une pièce jointe hors des bornes, avant tout appel', async () => {
      const service = makeService(fakes, raw);

      await expect(
        service.sendMessage(sessionId, 'regarde', {
          images: [{ mediaType: 'image/tiff', data: 'AAAA' }],
        }),
      ).rejects.toThrow();

      // Un refus prévisible se dit tout de suite, pas après trente secondes d'IA.
      expect(await prisma.workflowChatMessage.count()).toBe(0);
    });
  });

  describe('les nœuds communautaires', () => {
    const firstMessage = () => JSON.stringify(fakes.calls?.[0]?.messages ?? []);

    it('annonce leur mode d’emploi sans le servir', async () => {
      fakes.community = [
        {
          packageName: 'n8n-nodes-foo',
          nodeTypes: ['n8n-nodes-foo.foo'],
          installedVersion: '1.2.0',
          docs: [{ kind: 'auto', source: 'npm', version: '1.2.0', chars: 12000, fetchedAt: new Date() }],
        },
      ];
      await makeService(fakes, raw).sendMessage(sessionId, 'configure Foo');

      expect(firstMessage()).toMatch(/n8n-nodes-foo 1\.2\.0/);
      expect(firstMessage()).toMatch(/read_node_docs/);
      expect(fakes.ensured ?? []).toEqual([]);
    });

    it('dit qu’un paquet n’a pas de doc et la fait chercher pour le tour suivant', async () => {
      fakes.community = [{ packageName: 'n8n-nodes-bar', nodeTypes: ['n8n-nodes-bar.bar'], docs: [] }];
      await makeService(fakes, raw).sendMessage(sessionId, 'configure Bar');

      expect(firstMessage()).toMatch(/NO docs/);
      expect(fakes.ensured).toEqual(['n8n-nodes-bar']);
    });

    it('ne dit rien d’un workflow sans nœud communautaire', async () => {
      await makeService(fakes, raw).sendMessage(sessionId, 'bonjour');

      expect(firstMessage()).not.toMatch(/COMMUNITY/);
    });
  });

  describe('quand le tour tourne mal', () => {
    it('conserve la demande et annonce l’échec dans le fil', async () => {
      fakes.reply = new Error('quota dépassé');
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'corrige le nœud HTTP');

      // En 500 ou en silence, la demande semblait s'être perdue toute seule.
      expect(result.assistantMessage?.content).toMatch(/a échoué/i);
      expect(result.assistantMessage?.content).toContain('quota dépassé');
      const messages = await prisma.workflowChatMessage.findMany({ orderBy: { createdAt: 'asc' } });
      expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    });

    it('défait la demande quand l’humain arrête le tour', async () => {
      fakes.reply = new Error('interrompu');
      fakes.cancelled = true;
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'finalement non');

      // On n'arrête un tour que pour reformuler : la demande revient dans la saisie.
      expect(result.cancelled?.content).toBe('finalement non');
      expect(result.assistantMessage).toBeNull();
      expect(await prisma.workflowChatMessage.count()).toBe(0);
    });

    it('ne persiste jamais une réponse vide', async () => {
      fakes.reply = envelope('   ');
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'et alors ?');

      expect(result.assistantMessage?.content.trim()).not.toBe('');
    });

    it('dit qu’une enveloppe illisible n’a rien retenu', async () => {
      fakes.reply = '{"reply":"Voici la correction","proposal":{"summary":"gros","operations":[{"op"';
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'gros changement');

      // Sans ce mot, l'explication s'affiche et le diff n'arrive jamais.
      expect(result.assistantMessage?.content).toMatch(/illisible/i);
      expect(result.proposalId).toBeNull();
    });
  });

  describe('quand le modèle propose une modification', () => {
    it('crée la proposition et la rattache au message', async () => {
      fakes.reply = envelope('Je renomme le déclencheur.', {
        summary: 'Renommer',
        operations: [{ op: 'rename-node', node: 'Déclencheur', newName: 'Start' }],
        targets: [],
      });
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'renomme le déclencheur');

      expect(fakes.created).toHaveLength(1);
      expect(result.proposalId).toBe('prop-1');
      const assistant = await prisma.workflowChatMessage.findFirstOrThrow({ where: { role: 'assistant' } });
      expect(assistant.proposalId).toBe('prop-1');
    });

    it('reprend le verdict de la porte dans la conversation', async () => {
      fakes.gateReason = 'sous-clé « values » non déclarée par le nœud';
      fakes.reply = envelope('Voilà.', {
        summary: 'Renommer',
        operations: [{ op: 'rename-node', node: 'Déclencheur', newName: 'Start' }],
        targets: [],
      });
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(sessionId, 'change ça');

      // C'est dans la conversation qu'on décide de redemander autre chose : le
      // verdict ne peut pas vivre seulement dans l'écran de revue.
      expect(result.assistantMessage?.content).toContain('sous-clé');
    });
  });

  describe('la session', () => {
    it('prend pour titre la première demande', async () => {
      const service = makeService(fakes, raw);

      await service.sendMessage(sessionId, 'pourquoi ce workflow échoue le lundi ?');

      const session = await prisma.workflowChatSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.title).toBe('pourquoi ce workflow échoue le lundi ?');
    });

    it('ne rebaptise pas une session déjà entamée', async () => {
      const service = makeService(fakes, raw);
      await service.sendMessage(sessionId, 'première demande');

      await service.sendMessage(sessionId, 'seconde demande, bien plus longue et sans rapport');

      const session = await prisma.workflowChatSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.title).toBe('première demande');
    });
  });

  describe('sur un scénario Make', () => {
    it('confie le tour au service Make, et enregistre sa réponse comme n importe quelle autre', async () => {
      const instance = await prisma.instance.create({
        data: { name: 'Make', baseUrl: 'eu1.make.com', apiKey: 'k', platform: 'make' },
      });
      const scenario = await prisma.workflow.create({
        data: {
          instanceId: instance.id,
          externalId: '4210',
          name: 'Sync CRM',
          active: false,
          tags: [],
          hash: 'h',
          raw: { name: 'Sync CRM', flow: [], metadata: {} },
        },
      });
      const makeSession = await prisma.workflowChatSession.create({
        data: { workflowId: scenario.id, title: 'Nouvelle' },
      });
      const calls: Array<{ workflowId: string; history: unknown[] }> = [];
      fakes.makeTurn = {
        async answer(input: { workflowId: string; history: unknown[] }) {
          calls.push(input);
          return { reply: 'Scénario lu.', proposalId: null, trace: [], thinking: [] };
        },
      } as unknown as MakeChatTurnService;
      const service = makeService(fakes, raw);

      const result = await service.sendMessage(makeSession.id, 'que fait ce scénario ?');

      expect(calls).toHaveLength(1);
      expect(calls[0].workflowId).toBe(scenario.id);
      expect(fakes.n8nCalls ?? 0).toBe(0);
      expect(result.assistantMessage?.content).toBe('Scénario lu.');
    });
  });
});
