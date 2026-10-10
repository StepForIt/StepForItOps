import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FindingAutoFixService } from '../src/modules/workflow-chat/finding-autofix.service';
import { FindingFixAllService } from '../src/modules/workflow-chat/finding-fix-all.service';
import { FindingFixService } from '../src/modules/workflow-chat/finding-fix.service';
import { ProposalService } from '../src/modules/workflow-chat/proposal.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { DEFAULT_ENVS } from '@nwm/core';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow } from './helpers/workflow-fixtures';

/**
 * « Tout corriger » orchestre, il ne rédige ni n'écrit lui-même : ce qui est
 * vérifié ici, c'est la décision — écrire d'office ou laisser à la relecture —
 * et que la part IA ne part jamais sur une proposition déjà en attente.
 */

const prisma = testPrisma();

function makeService(opts: { aiProposal: string | null; applyFails?: boolean }) {
  const applied: string[] = [];
  const settings = {
    declaredEnvs: async () => DEFAULT_ENVS,
    declaredEnvIds: async () => DEFAULT_ENVS.map((env) => env.id),
  } as unknown as PlatformSettingsService;
  const autoFix = {
    propose: async () => ({ workflowId: 'w', proposalId: 'auto1', skipped: 0 }),
  } as unknown as FindingAutoFixService;
  let aiCalls = 0;
  const aiFix = {
    proposeFix: async () => {
      aiCalls++;
      return { workflowId: 'w', sessionId: 's1', proposalId: opts.aiProposal, reply: '' };
    },
  } as unknown as FindingFixService;
  const proposals = {
    apply: async (id: string) => {
      if (opts.applyFails) throw new (await import('@nestjs/common')).BadRequestException('porte');
      applied.push(id);
    },
  } as unknown as ProposalService;
  return {
    service: new FindingFixAllService(
      prisma as unknown as PrismaService,
      settings,
      autoFix,
      aiFix,
      proposals,
    ),
    applied,
    aiCalls: () => aiCalls,
  };
}

describe('FindingFixAllService', () => {
  beforeEach(resetDb);
  afterAll(async () => prisma.$disconnect());

  async function seed(name: string, tags: string[]) {
    const workflowId = await seedWorkflow(prisma, await seedInstance(prisma), n8nWorkflow('wf1', name, {}));
    await prisma.workflow.update({ where: { id: workflowId }, data: { tags } });
    const auto = await prisma.finding.create({
      data: {
        workflowId,
        module: 'verifier',
        severity: 'error',
        code: 'loop-not-closed',
        message: 'a',
        nodeName: 'L',
        data: { autoFix: true },
      },
    });
    const manual = await prisma.finding.create({
      data: { workflowId, module: 'verifier', severity: 'warning', code: 'x', message: 'b', nodeName: 'N' },
    });
    return [auto.id, manual.id];
  }

  it('écrit règle puis IA quand l’env n’est pas surveillé', async () => {
    const ids = await seed('Facturation - DEV', ['env:dev']);
    const { service, applied } = makeService({ aiProposal: 'ai1' });
    const result = await service.fixAll(ids);
    expect(applied).toEqual(['auto1', 'ai1']);
    expect(result).toMatchObject({ autoApplied: 1, aiApplied: 1, reviewProposalId: null, remaining: 0 });
  });

  it('n’écrit rien en prod : la proposition attend la relecture, et l’IA n’est pas appelée', async () => {
    const ids = await seed('Facturation - PROD', ['env:prod']);
    const { service, applied, aiCalls } = makeService({ aiProposal: 'ai1' });
    const result = await service.fixAll(ids);
    expect(applied).toEqual([]);
    expect(aiCalls()).toBe(0);
    expect(result.reviewProposalId).toBe('auto1');
    expect(result.remaining).toBe(2);
  });

  it('un refus de la porte laisse la proposition à relire sans faire échouer le geste', async () => {
    const ids = await seed('Facturation - DEV', ['env:dev']);
    const { service } = makeService({ aiProposal: 'ai1', applyFails: true });
    const result = await service.fixAll(ids);
    expect(result).toMatchObject({ autoApplied: 0, reviewProposalId: 'auto1', reviewReason: 'porte' });
  });
});
