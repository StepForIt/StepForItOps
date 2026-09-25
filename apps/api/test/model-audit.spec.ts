import { beforeEach, describe, expect, it } from 'vitest';
import { N8nWorkflow } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ModelAuditService } from '../src/modules/model-audit/model-audit.service';
import { ModelAuditSettingsService } from '../src/modules/model-audit/model-audit-settings.service';
import { NodeUsageService } from '../src/modules/model-audit/node-usage.service';
import { ModelCatalogService } from '../src/infra/model-catalog/model-catalog.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * L'audit des modèles contre une vraie base.
 *
 * Ce que ces cas tiennent, ce sont les promesses que le service fait au reste de
 * la plateforme et qu'aucun test pur ne peut voir : les findings arrivent bien
 * dans la table commune sous le nom du module (donc « Corriger (IA) » et les
 * règles d'exclusion marchent), une économie ne se calcule que sur des mesures
 * lues en base, et une passe REMPLACE ses findings au lieu de les empiler.
 */

const prisma = testPrisma() as unknown as PrismaService;

function workflowRaw(model: string): N8nWorkflow {
  return {
    name: 'Traduction',
    nodes: [
      { name: 'Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', parameters: { model } },
      { name: 'Traduire', type: '@n8n/n8n-nodes-langchain.chainLlm', parameters: { text: 'Traduis.' } },
    ],
    connections: {
      'Chat Model': { ai_languageModel: [[{ node: 'Traduire', type: 'ai_languageModel', index: 0 }]] },
    },
  } as N8nWorkflow;
}

/** Le service, monté à la main : ses collaborateurs sont des ports ou des services simples. */
function makeService(): { service: ModelAuditService; catalog: ModelCatalogService } {
  const catalog = new ModelCatalogService(prisma);
  const settings = {
    async workflowFilter() {
      return {};
    },
    async declaredEnvIds() {
      return ['dev', 'prod'];
    },
  };
  const profiles = {
    async effective() {
      return [] as string[];
    },
  };
  // L'IA n'est pas configurée : la classification ne se fait pas, et l'audit
  // continue sans elle — c'est exactement le repli qu'on veut garantir.
  const tasks = {
    async classify() {
      return {};
    },
    async verdicts() {
      return {};
    },
  };
  const ignores = {
    async filterIgnored(_workflowId: string, _module: string, findings: unknown[]) {
      return { kept: findings, ignoredCount: 0 };
    },
  };
  const service = new ModelAuditService(
    prisma,
    settings as never,
    profiles as never,
    catalog,
    new NodeUsageService(prisma),
    tasks as never,
    ignores as never,
    new ModelAuditSettingsService(prisma),
  );
  return { service, catalog };
}

async function seedWorkflow(model: string): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name: 'n8n', baseUrl: 'http://n8n', apiKey: 'k', platform: 'n8n' },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: 'w1',
      name: 'Traduction',
      hash: 'h',
      raw: workflowRaw(model) as never,
    },
  });
  return workflow.id;
}

describe('ModelAuditService', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.modelCatalog.deleteMany();
    await prisma.modelAuditSettings.deleteMany();
  });

  it('range ses findings dans la table commune, sous le nom du module', async () => {
    const { service } = makeService();
    const workflowId = await seedWorkflow('claude-3-opus'); // déprécié dans le seed

    const findings = await service.auditWorkflow(workflowId);
    expect(findings.map((finding) => finding.code)).toContain('model-deprecated');
    expect(findings.every((finding) => finding.module === 'model-audit')).toBe(true);

    const stored = await prisma.finding.findMany({ where: { workflowId, module: 'model-audit' } });
    expect(stored).toHaveLength(findings.length);
  });

  it('REMPLACE ses findings à chaque passe au lieu de les empiler', async () => {
    const { service } = makeService();
    const workflowId = await seedWorkflow('claude-3-opus');
    await service.auditWorkflow(workflowId);
    const after = await service.auditWorkflow(workflowId);
    const stored = await prisma.finding.count({ where: { workflowId, module: 'model-audit' } });
    expect(stored).toBe(after.length);
  });

  it("n'annonce une économie que sur des tokens réellement mesurés", async () => {
    const { service } = makeService();
    const workflowId = await seedWorkflow('claude-sonnet-5');
    const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });

    const sansMesure = await service.auditWorkflow(workflowId);
    expect(sansMesure.map((finding) => finding.code)).not.toContain('model-cheaper-alternative');

    // Un mois d'appels sur un modèle standard : le catalogue en connaît un moins
    // cher, de même niveau et aux mêmes aptitudes.
    await prisma.modelCatalog.updateMany({
      where: { pattern: 'claude-sonnet-4' },
      data: { inputPerMTok: 0.3, outputPerMTok: 1.5 },
    });
    await prisma.llmUsage.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        instanceId: workflow.instanceId,
        executionId: `e${index}`,
        externalWorkflowId: workflow.externalId,
        nodeName: 'Chat Model',
        runIndex: 0,
        callIndex: 0,
        itemIndex: index,
        model: 'claude-sonnet-5',
        promptTokens: 20_000,
        completionTokens: 2_000,
        totalTokens: 22_000,
        costUsd: 1,
        startedAt: new Date(),
      })),
    });

    const avecMesure = await service.auditWorkflow(workflowId);
    const cheaper = avecMesure.find((finding) => finding.code === 'model-cheaper-alternative');
    expect(cheaper).toBeDefined();
    // La fenêtre du candidat couvre le p95 mesuré : sinon il serait écarté, et
    // c'est `model-context-too-small` qui parlerait à sa place.
    expect(avecMesure.map((finding) => finding.code)).not.toContain('model-context-too-small');
    expect((cheaper?.data as { savingsAnnualUsd: number }).savingsAnnualUsd).toBeGreaterThan(0);
  });

  it('se tait entièrement sur un workflow sans nœud LLM', async () => {
    const { service } = makeService();
    const instance = await prisma.instance.create({
      data: { name: 'n8n', baseUrl: 'http://n8n', apiKey: 'k', platform: 'n8n' },
    });
    const workflow = await prisma.workflow.create({
      data: {
        instanceId: instance.id,
        externalId: 'w2',
        name: 'Sans IA',
        hash: 'h',
        raw: { name: 'Sans IA', nodes: [], connections: {} } as never,
      },
    });
    expect(await service.auditWorkflow(workflow.id)).toHaveLength(0);
  });

  it("n'audite pas un scénario Make : c'est une dette annoncée, pas un audit vide", async () => {
    const { service } = makeService();
    const instance = await prisma.instance.create({
      data: { name: 'make', baseUrl: 'https://eu1.make.com', apiKey: 'k', platform: 'make' },
    });
    const workflow = await prisma.workflow.create({
      data: { instanceId: instance.id, externalId: '42', name: 'Scénario', hash: 'h', raw: {} as never },
    });
    expect(await service.auditWorkflow(workflow.id)).toHaveLength(0);
  });

  it('la vue de parc compte les workflows par modèle', async () => {
    const { service } = makeService();
    await seedWorkflow('claude-3-opus');
    const summary = await service.summary();
    const row = summary.models.find((model) => model.model === 'claude-3-opus');
    expect(row?.workflows).toBe(1);
    expect(row?.status).toBe('deprecated');
    expect(summary.freshness.stale).toBe(false);
  });
});
