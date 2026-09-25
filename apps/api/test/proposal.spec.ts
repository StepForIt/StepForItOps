import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nApiError, N8nWorkflow, WorkflowEditOperation, hashWorkflow } from '@nwm/core';
import { ProposalService } from '../src/modules/workflow-chat/proposal.service';
import { MakeProposalService } from '../src/modules/workflow-chat/make-proposal.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { InstanceCredentialsService } from '../src/modules/workflow-chat/instance-credentials.service';
import { InstanceShapesService } from '../src/modules/workflow-chat/instance-shapes.service';
import { NodeCatalogService } from '../src/infra/node-catalog/node-catalog.service';
import { RestorePointService } from '../src/modules/workflow-chat/restore-point.service';
import { ChatLeftoversService } from '../src/modules/workflow-chat/chat-leftovers.service';
import { EnvChainGuardService } from '../src/infra/settings/env-chain-guard.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { N8nApiPort } from '@nwm/core';
import {
  WorkflowLockService,
  WorkflowLockedException,
} from '../src/infra/workflow-lock/workflow-lock.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow, withEnv } from './helpers/workflow-fixtures';

/**
 * La porte de l'assistant, et le garde-fou d'empreinte.
 *
 * Tout ce qui suit protège la même chose : on écrit le workflow ENTIER dans
 * n8n. Une modification appliquée sur une base périmée n'écrase pas une ligne,
 * elle écrase tout ce que quelqu'un a fait dans l'éditeur depuis. D'où un refus
 * quand l'empreinte a bougé, une relecture depuis n8n avant de comparer, et des
 * sous-workflows écrits AVANT l'appelant — un geste à moitié écrit doit laisser
 * la moitié qui se rattrape.
 */

const prisma = testPrisma();

/** Ce que n8n sert et ce qu'il a reçu : le test lit les deux. */
interface Upstream {
  content: Map<string, N8nWorkflow>;
  writes: Array<{ externalId: string; workflow: N8nWorkflow }>;
  refuse?: Error;
}

function makeService(upstream: Upstream, options: { chainRefusal?: string } = {}) {
  const n8n = {
    async getWorkflow(_config: unknown, externalId: string) {
      const found = upstream.content.get(externalId);
      if (!found) throw new N8nApiError('introuvable', 404);
      return found;
    },
    async updateWorkflow(_config: unknown, externalId: string, workflow: N8nWorkflow) {
      if (upstream.refuse) throw upstream.refuse;
      upstream.writes.push({ externalId, workflow });
      upstream.content.set(externalId, workflow);
      return workflow;
    },
  } as unknown as N8nApiPort;

  const workflows = {
    async getFreshRaw(id: string) {
      const row = await prisma.workflow.findUniqueOrThrow({ where: { id } });
      const live = upstream.content.get(row.externalId);
      if (!live) {
        return {
          workflow: withEnv(row, { missingInN8n: true }),
          raw: row.raw as unknown as N8nWorkflow,
          missing: true,
        };
      }
      // Comme le vrai service : l'empreinte rendue est celle de n8n, pas celle
      // du miroir — c'est tout l'intérêt de relire avant d'écrire.
      return {
        workflow: withEnv(row, {
          hash: hashWorkflow(live),
          name: live.name,
          archived: row.tags.includes('archived'),
        }),
        raw: live,
        missing: false,
      };
    },
  } as unknown as WorkflowsService;

  const shapes = {
    async check() {
      return [];
    },
  } as unknown as InstanceShapesService;
  const nodeCatalog = {
    // Une `error` posée sur le nœud « Fautif » : la porte ne compte que ce que la
    // modification INTRODUIT, donc c'est bien la présence de ce nœud dans le
    // CANDIDAT — et son absence avant — qui bloque.
    async check(workflow: N8nWorkflow) {
      return (workflow.nodes ?? []).some((node) => node.name === 'Fautif')
        ? [
            {
              severity: 'error' as const,
              code: 'node-schema-unknown-collection-key',
              message: 'sous-clé « values » non déclarée par le nœud',
              nodeName: 'Fautif',
            },
          ]
        : [];
    },
  } as unknown as NodeCatalogService;
  const credentials = {
    async fillAddedNodes(_instanceId: string, _before: N8nWorkflow, after: N8nWorkflow) {
      return { workflow: after, filled: [] };
    },
  } as unknown as InstanceCredentialsService;
  const restorePoints = {
    async find() {
      return null;
    },
  } as unknown as RestorePointService;
  const leftovers = {
    async list() {
      return [];
    },
  } as unknown as ChatLeftoversService;
  const envChain = {
    async assertDirectWriteAllowed() {
      if (options.chainRefusal) throw new Error(options.chainRefusal);
    },
  } as unknown as EnvChainGuardService;
  const settings = {
    async declaredEnvIds() {
      return ['dev', 'preprod', 'prod'];
    },
  } as unknown as PlatformSettingsService;
  const instances = {
    async getConfig() {
      return { baseUrl: 'http://n8n', apiKey: 'k' };
    },
  } as unknown as InstancesService;
  const sync = {
    async upsertWorkflow() {
      return { hashChanged: true };
    },
  } as unknown as WorkflowSyncService;

  return new ProposalService(
    prisma as unknown as PrismaService,
    workflows,
    sync,
    instances,
    credentials,
    shapes,
    nodeCatalog,
    restorePoints,
    leftovers,
    envChain,
    n8n,
    settings,
    // Jamais appelé : les workflows de ces cas sont servis par une instance n8n.
    {} as MakeProposalService,
    new WorkflowLockService(prisma as unknown as PrismaService),
  );
}

/** Une opération anodine : renommer un nœud. Le contenu importe peu, le chemin oui. */
function rename(from: string, to: string): WorkflowEditOperation {
  return { op: 'rename-node', node: from, newName: to } as WorkflowEditOperation;
}

/** Une opération qui INTRODUIT une `error` : refus de qualité, contournable. */
function introduceError(): WorkflowEditOperation {
  return rename('Déclencheur', 'Fautif');
}

/**
 * Une opération qui CASSE le workflow : le dernier déclencheur retiré. C'est une
 * atteinte à l'INTÉGRITÉ, et celle-là ne se contourne pas.
 */
function removeTrigger(): WorkflowEditOperation {
  return { op: 'remove-node', node: 'Déclencheur' } as WorkflowEditOperation;
}

describe('ProposalService', () => {
  let upstream: Upstream;

  beforeEach(async () => {
    await resetDb();
    upstream = { content: new Map(), writes: [] };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(raw = n8nWorkflow('wf1', 'Facturation')): Promise<string> {
    const instanceId = await seedInstance(prisma);
    upstream.content.set(String(raw.id), raw);
    return seedWorkflow(prisma, instanceId, raw);
  }

  describe('create', () => {
    it('refuse une proposition sans aucune opération', async () => {
      const id = await seed();
      const service = makeService(upstream);

      await expect(service.create(id, null, 'rien', [])).rejects.toThrow(/aucune opération/);
      expect(await prisma.workflowChatProposal.count()).toBe(0);
    });

    it('enregistre la proposition MÊME refusée par la porte', async () => {
      const id = await seed();
      const service = makeService(upstream);

      const { proposal, gate } = await service.create(id, null, 'casser', [removeTrigger()]);

      // C'est l'application qui est refusée, pas la conversation : sans la
      // proposition en base, il n'y aurait aucun diff à relire pour comprendre.
      expect(gate.blocked).toBe(true);
      expect(
        await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposal.id } }),
      ).toMatchObject({
        status: 'pending',
      });
    });

    it('ne laisse rien en base quand un sous-workflow est inapplicable', async () => {
      const id = await seed();
      const other = n8nWorkflow('wf2', 'Envoi');
      upstream.content.set('wf2', other);
      const otherId = await seedWorkflow(
        prisma,
        (await prisma.workflow.findUniqueOrThrow({ where: { id } })).instanceId,
        other,
      );
      const service = makeService(upstream);

      await expect(
        service.create(
          id,
          null,
          'découpe',
          [rename('Déclencheur', 'Start')],
          [{ workflowId: otherId, operations: [rename('Nœud inexistant', 'X')] }],
        ),
      ).rejects.toThrow();

      // Une racine orpheline cacherait la moitié du geste dans son diff.
      expect(await prisma.workflowChatProposal.count()).toBe(0);
    });
  });

  describe('review', () => {
    it('signale que le workflow a bougé depuis la préparation', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      expect((await service.review(proposal.id)).stale).toBe(false);

      // Quelqu'un édite dans n8n entre-temps.
      upstream.content.set('wf1', n8nWorkflow('wf1', 'Facturation', { nodes: [] }));

      expect((await service.review(proposal.id)).stale).toBe(true);
    });

    it('dit que les opérations ne sont plus rejouables plutôt que d’échouer', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      // Le nœud visé a disparu de n8n : la revue doit rester lisible.
      upstream.content.set('wf1', n8nWorkflow('wf1', 'Facturation', { nodes: [] }));

      const review = await service.review(proposal.id);
      expect(review.warnings.join(' ')).toMatch(/non rejouables/i);
      expect(review.diff).toBeDefined();
    });
  });

  describe('apply', () => {
    it('écrit dans n8n, clôt la proposition et resynchronise', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      const result = await service.apply(proposal.id);

      expect(result.ok).toBe(true);
      expect(upstream.writes).toHaveLength(1);
      expect(upstream.writes[0]?.workflow.nodes[0]?.name).toBe('Start');
      expect(
        (await prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
      ).toBe('applied');
    });

    it('refuse en 409 quand le workflow a changé dans n8n', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      upstream.content.set('wf1', n8nWorkflow('wf1', 'Facturation', { nodes: [] }));

      await expect(service.apply(proposal.id)).rejects.toMatchObject({ status: 409 });
      // Et rien n'est parti : c'est tout l'intérêt du garde-fou.
      expect(upstream.writes).toHaveLength(0);
    });

    it('refuse une proposition déjà appliquée', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);
      await service.apply(proposal.id);

      await expect(service.apply(proposal.id)).rejects.toThrow(/déjà appliquée/);
      expect(upstream.writes).toHaveLength(1);
    });

    it('n’écrit rien quand la porte refuse, et le dit dans le fil', async () => {
      const id = await seed();
      const session = await prisma.workflowChatSession.create({
        data: { workflowId: id, title: 'Essai' },
      });
      const service = makeService(upstream);
      const { proposal } = await service.create(id, session.id, 'poser une sous-clé inconnue', [
        introduceError(),
      ]);

      await expect(service.apply(proposal.id)).rejects.toThrow();

      expect(upstream.writes).toHaveLength(0);
      // Le refus décide de ce qu'il faut demander ensuite : l'assistant doit le
      // voir passer, sinon il repropose la même chose au tour suivant.
      const notes = await prisma.workflowChatMessage.findMany({ where: { sessionId: session.id } });
      expect(notes.map((note) => note.content).join(' ')).toContain('Application refusée');
    });

    it('applique quand même sur `force`, coché par un humain', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'poser une sous-clé inconnue', [introduceError()]);

      await expect(service.apply(proposal.id)).rejects.toThrow();
      await service.apply(proposal.id, true);

      expect(upstream.writes).toHaveLength(1);
    });

    it('ne laisse PAS `force` ouvrir une atteinte à l’intégrité', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'retirer le déclencheur', [removeTrigger()]);

      // Un refus de qualité est un jugement ; celui-ci dit que le workflow ne
      // tournerait plus. Le contourner ne produirait qu'une panne plus tard.
      await expect(service.apply(proposal.id, true)).rejects.toThrow(/ne se contourne pas/);
      expect(upstream.writes).toHaveLength(0);
    });

    it('refuse d’écrire dans un workflow que n8n ne connaît plus', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      upstream.content.delete('wf1');

      await expect(service.apply(proposal.id)).rejects.toThrow(/ne connaît plus/);
    });

    it('s’arrête avant tout le reste sur un refus de chaîne d’environnements', async () => {
      const id = await seed();
      const prepared = makeService(upstream);
      const { proposal } = await prepared.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);

      const guarded = makeService(upstream, { chainRefusal: 'prod ne se modifie qu’en promouvant' });
      await expect(guarded.apply(proposal.id)).rejects.toThrow(/promouvant/);
      expect(upstream.writes).toHaveLength(0);
    });
    it('refuse d’écrire dans un exemplaire verrouillé, forcé ou non', async () => {
      const id = await seed();
      const service = makeService(upstream);
      const { proposal } = await service.create(id, null, 'renommer', [rename('Déclencheur', 'Start')]);
      await new WorkflowLockService(prisma as unknown as PrismaService).lock(id);

      // `force` lève les gates de qualité, jamais un verrou.
      await expect(service.apply(proposal.id, true)).rejects.toBeInstanceOf(WorkflowLockedException);
      expect(upstream.writes).toHaveLength(0);
    });
  });

  describe('apply, avec des sous-workflows', () => {
    async function seedPair(): Promise<{ rootId: string; partId: string }> {
      const instanceId = await seedInstance(prisma);
      const root = n8nWorkflow('wf1', 'Facturation');
      const sub = n8nWorkflow('wf2', 'Envoi de la facture');
      upstream.content.set('wf1', root);
      upstream.content.set('wf2', sub);
      return {
        rootId: await seedWorkflow(prisma, instanceId, root),
        partId: await seedWorkflow(prisma, instanceId, sub),
      };
    }

    it('refuse toute la proposition quand un sous-workflow visé est verrouillé', async () => {
      const { rootId, partId } = await seedPair();
      const service = makeService(upstream);
      const { proposal } = await service.create(
        rootId,
        null,
        'découpe',
        [rename('Déclencheur', 'Start')],
        [{ workflowId: partId, operations: [rename('Déclencheur', 'Entrée')] }],
      );
      await new WorkflowLockService(prisma as unknown as PrismaService).lock(partId);

      await expect(service.apply(proposal.id)).rejects.toBeInstanceOf(WorkflowLockedException);
      expect(upstream.writes).toHaveLength(0);
    });

    it('écrit les sous-workflows AVANT l’appelant', async () => {
      const { rootId, partId } = await seedPair();
      const service = makeService(upstream);
      const { proposal } = await service.create(
        rootId,
        null,
        'découpe',
        [rename('Déclencheur', 'Start')],
        [{ workflowId: partId, operations: [rename('Déclencheur', 'Entrée')] }],
      );

      await service.apply(proposal.id);

      // L'appelant pose souvent l'appel vers un contenu qui doit déjà exister.
      expect(upstream.writes.map((write) => write.externalId)).toEqual(['wf2', 'wf1']);
    });

    it('ne touche PAS l’appelant quand un sous-workflow a bougé', async () => {
      const { rootId, partId } = await seedPair();
      const service = makeService(upstream);
      const { proposal } = await service.create(
        rootId,
        null,
        'découpe',
        [rename('Déclencheur', 'Start')],
        [{ workflowId: partId, operations: [rename('Déclencheur', 'Entrée')] }],
      );

      upstream.content.set('wf2', n8nWorkflow('wf2', 'Envoi de la facture', { nodes: [] }));

      await expect(service.apply(proposal.id)).rejects.toMatchObject({ status: 409 });
      // Les annexes sont contrôlées ENTIÈREMENT avant que quoi que ce soit ne
      // parte : un geste indivisible ne s'écrit pas à moitié.
      expect(upstream.writes).toHaveLength(0);
    });

    it('applique une proposition qui ne vise QUE le sous-workflow, sans écrire l’appelant', async () => {
      const { rootId, partId } = await seedPair();
      const service = makeService(upstream);
      const { proposal } = await service.create(
        rootId,
        null,
        'remplir l’appelé',
        [],
        [{ workflowId: partId, operations: [rename('Déclencheur', 'Entrée')] }],
      );

      const result = await service.apply(proposal.id);

      expect(result.ok).toBe(true);
      // Un PUT à l'identique ferait une version de plus et promettrait un point
      // de retour sur un workflow que personne n'a touché.
      expect(upstream.writes.map((write) => write.externalId)).toEqual(['wf2']);
      expect(result.versionCreated).toBe(false);
    });
  });

  describe('discard', () => {
    it('emporte les sous-workflows avec la racine', async () => {
      const instanceId = await seedInstance(prisma);
      const root = n8nWorkflow('wf1', 'Facturation');
      const sub = n8nWorkflow('wf2', 'Envoi');
      upstream.content.set('wf1', root);
      upstream.content.set('wf2', sub);
      const rootId = await seedWorkflow(prisma, instanceId, root);
      const partId = await seedWorkflow(prisma, instanceId, sub);
      const service = makeService(upstream);
      const { proposal } = await service.create(
        rootId,
        null,
        'découpe',
        [rename('Déclencheur', 'Start')],
        [{ workflowId: partId, operations: [rename('Déclencheur', 'Entrée')] }],
      );

      await service.discard(proposal.id);

      const parts = await prisma.workflowChatProposalPart.findMany({ where: { proposalId: proposal.id } });
      // Une moitié restée « en attente » se lirait comme un geste à finir.
      expect(parts.map((part) => part.status)).toEqual(['discarded']);
    });
  });
});
