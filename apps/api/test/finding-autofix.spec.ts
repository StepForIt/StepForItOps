import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nWorkflow, WorkflowEditOperation } from '@nwm/core';
import { FindingAutoFixService } from '../src/modules/workflow-chat/finding-autofix.service';
import { ProposalService } from '../src/modules/workflow-chat/proposal.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow } from './helpers/workflow-fixtures';

/**
 * Le correctif sans IA ne rédige rien de lui-même au moment de l'analyse : il
 * repart de n8n au clic. Ce qui est vérifié ici, c'est ce chemin — l'état frais
 * fait foi, et un correctif devenu faux n'est jamais proposé.
 */

const prisma = testPrisma();

const LOOP = {
  name: 'Loop',
  type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 3,
  parameters: {},
  position: [0, 0],
};
const BODY = { name: 'Traiter', type: 'n8n-nodes-base.noOp', parameters: {}, position: [200, 0] };

function bodyOnDone(): N8nWorkflow {
  return n8nWorkflow('wf1', 'Facturation', {
    nodes: [LOOP, BODY] as N8nWorkflow['nodes'],
    connections: {
      Loop: { main: [[{ node: 'Traiter', type: 'main', index: 0 }]] },
      Traiter: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
    },
  });
}

function makeService(live: { raw: N8nWorkflow }) {
  const created: Array<{ workflowId: string; summary: string; operations: WorkflowEditOperation[] }> = [];
  const workflows = {
    async getFreshRaw() {
      return { workflow: {}, raw: live.raw, missing: false };
    },
  } as unknown as WorkflowsService;
  const proposals = {
    async create(workflowId: string, _session: null, summary: string, operations: WorkflowEditOperation[]) {
      created.push({ workflowId, summary, operations });
      return { proposal: { id: `p${created.length}` } };
    },
  } as unknown as ProposalService;
  return {
    service: new FindingAutoFixService(prisma as unknown as PrismaService, workflows, proposals),
    created,
  };
}

describe('FindingAutoFixService', () => {
  beforeEach(resetDb);
  afterAll(async () => prisma.$disconnect());

  async function seedFinding(raw: N8nWorkflow): Promise<{ workflowId: string; findingId: string }> {
    const workflowId = await seedWorkflow(prisma, await seedInstance(prisma), raw);
    const finding = await prisma.finding.create({
      data: {
        workflowId,
        module: 'verifier',
        severity: 'error',
        code: 'loop-body-on-done',
        message: 'corps sur done',
        nodeName: 'Loop',
        data: { autoFix: true },
      },
    });
    return { workflowId, findingId: finding.id };
  }

  it('crée une proposition ordinaire à partir de l’état de n8n', async () => {
    const { workflowId, findingId } = await seedFinding(bodyOnDone());
    const { service, created } = makeService({ raw: bodyOnDone() });

    const result = await service.propose([findingId]);

    expect(result).toEqual({ workflowId, proposalId: 'p1', skipped: 0 });
    expect(created[0]!.operations).toEqual([
      { op: 'disconnect', from: 'Loop', to: 'Traiter' },
      { op: 'connect', from: 'Loop', to: 'Traiter', fromOutput: 1, toInput: 0 },
    ]);
    expect(created[0]!.summary).toMatch(/sans IA/);
  });

  it('refuse quand n8n a déjà été corrigé depuis l’analyse', async () => {
    const { findingId } = await seedFinding(bodyOnDone());
    const repaired = bodyOnDone();
    repaired.connections.Loop = { main: [[], [{ node: 'Traiter', type: 'main', index: 0 }]] };
    const { service, created } = makeService({ raw: repaired });

    await expect(service.propose([findingId])).rejects.toThrow(/a changé depuis l’analyse/);
    expect(created).toHaveLength(0);
  });
});
