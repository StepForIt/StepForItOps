import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENVS } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { ImpactContextService } from '../src/modules/impact-study/impact-context.service';
import { ImpactStudyService } from '../src/modules/impact-study/impact-study.service';
import { ReleaseProceduresService } from '../src/modules/release-procedures/release-procedures.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow } from './helpers/workflow-fixtures';

/**
 * Étude d'impact : lue sur le miroir et l'historique, jamais dans n8n. Ce qui
 * compte est que chaque fait vienne de la bonne table et du bon exemplaire.
 */

const prisma = testPrisma() as unknown as PrismaService;
const settings = {
  async declaredEnvs() {
    return DEFAULT_ENVS;
  },
  async declaredEnvIds() {
    return DEFAULT_ENVS.map((env) => env.id);
  },
} as unknown as PlatformSettingsService;
const study = new ImpactStudyService(prisma, new ImpactContextService(prisma, settings));
const procedures = new ReleaseProceduresService(prisma, settings);

const callTo = (externalId: string) => ({
  name: 'Appeler',
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: { workflowId: externalId },
});

const webhook = {
  name: 'Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: [0, 0] as [number, number],
  parameters: { path: 'facture', httpMethod: 'POST' },
};

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ImpactStudyService', () => {
  it('rassemble appelants, exécutions, URL publique, sondes, tests et verrou en un niveau nommé', async () => {
    const instanceId = await seedInstance(prisma);
    const target = await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('w1', 'Facturation - PROD', { active: true, nodes: [webhook] }),
    );
    const caller = await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('w2', 'Relances - PROD', { nodes: [callTo('w1')] }),
    );
    await prisma.workflow.update({ where: { id: target }, data: { active: true } });
    await prisma.executionStat.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        instanceId,
        executionId: `e${i}`,
        externalWorkflowId: 'w1',
        status: i < 5 ? 'error' : 'success',
        startedAt: new Date(Date.now() - i * 60_000),
      })),
    });
    await prisma.monitor.create({ data: { workflowId: target, name: 'beat', kind: 'heartbeat' } });
    await prisma.testCase.create({
      data: { workflowId: target, name: 'cas', expected: {}, lastStatus: 'passed' },
    });
    await prisma.workflowLock.create({ data: { workflowId: target } });

    const { items, summary } = await study.studyWorkflows([target]);
    const [impact] = items;
    expect(impact.facts).toMatchObject({
      active: true,
      monitoredEnv: true,
      callers: 1,
      executions30d: 120,
      failures30d: 5,
      publicEntryPoints: 1,
      monitors: 1,
      testCases: 1,
      redTests: 0,
      locked: true,
    });
    expect(impact.callers.map((c) => c.id)).toEqual([caller]);
    expect(impact.level).toBe('critical');
    expect(impact.safeguards).toHaveLength(3);
    expect(summary).toMatchObject({ count: 1, highest: 'critical', externalCallers: 1 });
  });

  it("dans un lot, l'appelant coché avec son appelé n'est pas un appelant externe", async () => {
    const instanceId = await seedInstance(prisma);
    const target = await seedWorkflow(prisma, instanceId, n8nWorkflow('w1', 'Facturation - DEV'));
    const caller = await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('w2', 'Relances - DEV', { nodes: [callTo('w1')] }),
    );
    const { summary } = await study.studyWorkflows([target, caller]);
    expect(summary.externalCallers).toBe(0);
  });

  it('étudie le rejeu d’une procédure sur le saut demandé, exemplaire par exemplaire', async () => {
    const instanceId = await seedInstance(prisma);
    await seedWorkflow(prisma, instanceId, n8nWorkflow('w1', 'Facturation - PREPROD'));
    const prod = await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('w2', 'Facturation - PROD', { active: true }),
    );
    await prisma.workflow.update({ where: { id: prod }, data: { active: true } });

    const procedure = await procedures.start('Release', 'moi');
    await procedures.addGesture(procedure.id, {
      action: 'promote',
      familyKey: 'facturation',
      familyName: 'Facturation',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      options: {},
    });

    const result = await study.studyProcedure(procedure.id, { source: 'preprod', target: 'prod' });
    expect(result.hop).toEqual({ source: 'preprod', target: 'prod' });
    expect(result.targets.map((t) => [t.env, t.role, t.impact?.workflow.id ?? null])).toEqual([
      ['preprod', 'read', expect.any(String)],
      ['prod', 'write', prod],
    ]);

    // Sur le saut enregistré, l'exemplaire DEV n'existe pas : c'est dit, pas inventé.
    const recorded = await study.studyProcedure(procedure.id);
    expect(recorded.targets[0]).toMatchObject({ env: 'dev', impact: null });
    expect(recorded.targets[0].note).toBeTruthy();
  });
});
