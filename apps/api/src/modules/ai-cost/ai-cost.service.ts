import { Injectable } from '@nestjs/common';
import { EnvName, detectWorkflowEnv, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { ModelCatalogService } from '../../infra/model-catalog/model-catalog.service';
import { WorkflowCostFamily, groupCostsByFamily } from './cost-families';

export interface AiCostTotals {
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  executions: number;
  /** Part des appels dont les tokens sont estimés (streaming) : 0..1. */
  estimatedShare: number;
  /** Part des appels sans coût calculable (modèle absent de la table). */
  unpricedShare: number;
  /** Modèles rencontrés sans tarif : à ajouter depuis la page. */
  unknownModels: string[];
}

export interface WorkflowCost {
  instanceId: string;
  externalWorkflowId: string;
  workflowId: string | null;
  name: string;
  /** Env du workflow, déduit de son nom ou de ses tags — null si indéterminé. */
  env: EnvName | null;
  calls: number;
  executions: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Appels non valorisés : le coût affiché est un plancher, pas le total. */
  unpricedCalls: number;
  lastAt: string | null;
}

export interface ModelCost {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** null quand aucun appel de ce modèle n'a pu être valorisé. */
  costUsd: number | null;
}

export interface DailyCost {
  date: string; // YYYY-MM-DD
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
}

export interface AiCostSummary {
  days: number;
  from: string;
  to: string;
  totals: AiCostTotals;
  workflows: WorkflowCost[];
  /** Les mêmes coûts, regroupés par workflow métier (dev + preprod + prod). */
  families: WorkflowCostFamily[];
  models: ModelCost[];
  daily: DailyCost[];
}

export interface ExecutionCost {
  executionId: string;
  startedAt: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedCalls: number;
  models: string[];
}

/**
 * Synthèse des coûts LLM depuis les lignes LlmUsage (une par appel). Tout est
 * agrégé en mémoire sur la fenêtre demandée, comme le module performance : le
 * volume reste borné (les appels LLM sont rares à l'échelle des exécutions).
 */
@Injectable()
export class AiCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly catalog: ModelCatalogService,
  ) {}

  /**
   * Valorise les lignes restées sans coût (modèle inconnu à l'ingestion) avec le
   * catalogue actuel. Les coûts déjà calculés restent FIGÉS : ils décrivent ce
   * qu'on payait ce jour-là, pas ce qu'on paierait aujourd'hui.
   */
  async priceMissing(): Promise<{ updated: number; stillUnknown: number }> {
    const pricer = await this.catalog.pricer();
    const rows = await this.prisma.llmUsage.findMany({
      where: { costUsd: null },
      select: { id: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true },
    });
    let updated = 0;
    for (const row of rows) {
      const cost = pricer(row.model, row);
      if (cost === null) continue;
      await this.prisma.llmUsage.update({ where: { id: row.id }, data: { costUsd: cost } });
      updated++;
    }
    return { updated, stillUnknown: rows.length - updated };
  }

  async summary(instanceId: string | undefined, days: number): Promise<AiCostSummary> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);

    const rows = await this.prisma.llmUsage.findMany({
      where: { ...(instanceId ? { instanceId } : {}), startedAt: { gte: from, lt: to } },
      select: {
        instanceId: true,
        executionId: true,
        externalWorkflowId: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        isEstimate: true,
        costUsd: true,
        startedAt: true,
      },
    });

    // Noms + exclusion des archivés, résolus depuis la DB plateforme.
    const workflows = await this.prisma.workflow.findMany({
      where: {
        ...(instanceId ? { instanceId } : {}),
        ...(await this.settings.workflowFilter()),
      },
      select: { id: true, instanceId: true, externalId: true, name: true, tags: true },
    });
    const known = new Map(workflows.map((w) => [`${w.instanceId}|${w.externalId}`, w]));
    const envs = await this.settings.declaredEnvIds();

    const totals: AiCostTotals = {
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      executions: 0,
      estimatedShare: 0,
      unpricedShare: 0,
      unknownModels: [],
    };
    let estimated = 0;
    let unpriced = 0;
    const unknownModels = new Set<string>();
    const executionKeys = new Set<string>();

    interface WfAcc extends Omit<WorkflowCost, 'lastAt'> {
      lastAt: Date | null;
      executionIds: Set<string>;
    }
    const byWorkflow = new Map<string, WfAcc>();
    const byModel = new Map<
      string,
      { calls: number; promptTokens: number; completionTokens: number; costUsd: number; priced: number }
    >();
    const byDay = new Map<string, DailyCost>();

    for (const row of rows) {
      const wfKey = `${row.instanceId}|${row.externalWorkflowId}`;
      const workflow = known.get(wfKey);
      // Workflow inconnu de la plateforme = supprimé ou archivé : hors synthèse.
      if (!workflow) continue;

      totals.calls++;
      totals.promptTokens += row.promptTokens;
      totals.completionTokens += row.completionTokens;
      if (row.costUsd !== null) totals.costUsd += row.costUsd;
      else {
        unpriced++;
        if (row.model) unknownModels.add(row.model);
      }
      if (row.isEstimate) estimated++;
      executionKeys.add(`${row.instanceId}|${row.executionId}`);

      const wf =
        byWorkflow.get(wfKey) ??
        ({
          instanceId: row.instanceId,
          externalWorkflowId: row.externalWorkflowId,
          workflowId: workflow.id,
          name: workflow.name,
          env: detectWorkflowEnv(workflow.name, workflow.tags, envs),
          calls: 0,
          executions: 0,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
          lastAt: null,
          executionIds: new Set<string>(),
        } satisfies WfAcc);
      wf.calls++;
      wf.promptTokens += row.promptTokens;
      wf.completionTokens += row.completionTokens;
      if (row.costUsd !== null) wf.costUsd += row.costUsd;
      else wf.unpricedCalls++;
      wf.executionIds.add(row.executionId);
      if (!wf.lastAt || row.startedAt > wf.lastAt) wf.lastAt = row.startedAt;
      byWorkflow.set(wfKey, wf);

      const modelKey = row.model ?? msg('ops.unknownModel');
      const model = byModel.get(modelKey) ?? {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        priced: 0,
      };
      model.calls++;
      model.promptTokens += row.promptTokens;
      model.completionTokens += row.completionTokens;
      if (row.costUsd !== null) {
        model.costUsd += row.costUsd;
        model.priced++;
      }
      byModel.set(modelKey, model);

      const date = row.startedAt.toISOString().slice(0, 10);
      const day = byDay.get(date) ?? { date, costUsd: 0, promptTokens: 0, completionTokens: 0, calls: 0 };
      day.calls++;
      day.promptTokens += row.promptTokens;
      day.completionTokens += row.completionTokens;
      if (row.costUsd !== null) day.costUsd += row.costUsd;
      byDay.set(date, day);
    }

    totals.executions = executionKeys.size;
    totals.estimatedShare = totals.calls > 0 ? estimated / totals.calls : 0;
    totals.unpricedShare = totals.calls > 0 ? unpriced / totals.calls : 0;
    totals.unknownModels = [...unknownModels].sort();

    const workflowCosts: WorkflowCost[] = [...byWorkflow.values()]
      .map(({ executionIds, lastAt, ...wf }) => ({
        ...wf,
        executions: executionIds.size,
        lastAt: lastAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const modelCosts: ModelCost[] = [...byModel.entries()]
      .map(([model, acc]) => ({
        model,
        calls: acc.calls,
        promptTokens: acc.promptTokens,
        completionTokens: acc.completionTokens,
        costUsd: acc.priced > 0 ? acc.costUsd : null,
      }))
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));

    const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      totals,
      workflows: workflowCosts,
      families: groupCostsByFamily(workflowCosts, envs),
      models: modelCosts,
      daily,
    };
  }

  /**
   * Coût agrégé d'un workflow (id plateforme) sur la fenêtre — l'encart de la
   * page de détail. Null si le workflow est inconnu.
   */
  async workflowSummary(
    workflowId: string,
    days: number,
  ): Promise<{
    days: number;
    costUsd: number;
    calls: number;
    executions: number;
    promptTokens: number;
    completionTokens: number;
    unpricedCalls: number;
  } | null> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { instanceId: true, externalId: true },
    });
    if (!workflow) return null;
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await this.prisma.llmUsage.findMany({
      where: {
        instanceId: workflow.instanceId,
        externalWorkflowId: workflow.externalId,
        startedAt: { gte: from },
      },
      select: { executionId: true, promptTokens: true, completionTokens: true, costUsd: true },
    });
    const executions = new Set(rows.map((row) => row.executionId));
    return {
      days,
      costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
      calls: rows.length,
      executions: executions.size,
      promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
      completionTokens: rows.reduce((sum, row) => sum + row.completionTokens, 0),
      unpricedCalls: rows.filter((row) => row.costUsd === null).length,
    };
  }

  /** Coût par exécution d'un workflow (le drill-down de la table). */
  async executions(
    instanceId: string,
    externalWorkflowId: string,
    days: number,
    limit = 50,
  ): Promise<ExecutionCost[]> {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await this.prisma.llmUsage.findMany({
      where: { instanceId, externalWorkflowId, startedAt: { gte: from } },
      select: {
        executionId: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        costUsd: true,
        startedAt: true,
      },
      orderBy: { startedAt: 'desc' },
    });

    const byExecution = new Map<string, ExecutionCost & { modelSet: Set<string> }>();
    for (const row of rows) {
      const acc = byExecution.get(row.executionId) ?? {
        executionId: row.executionId,
        startedAt: row.startedAt.toISOString(),
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        unpricedCalls: 0,
        models: [],
        modelSet: new Set<string>(),
      };
      acc.calls++;
      acc.promptTokens += row.promptTokens;
      acc.completionTokens += row.completionTokens;
      if (row.costUsd !== null) acc.costUsd += row.costUsd;
      else acc.unpricedCalls++;
      if (row.model) acc.modelSet.add(row.model);
      byExecution.set(row.executionId, acc);
    }

    return [...byExecution.values()]
      .slice(0, limit)
      .map(({ modelSet, ...execution }) => ({ ...execution, models: [...modelSet].sort() }));
  }
}
