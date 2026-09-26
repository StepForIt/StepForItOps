import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nExecutionSummary,
  N8nWorkflow,
  detectLlmOutputNodes,
  detectSimplifiedOutputNodes,
  extractHttpLlmUsage,
  extractLlmUsage,
  isCheckDue,
  workflowHasLlmNodes,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { AI_COST_MANIFEST } from './manifest';
import { BudgetAlertService } from './budget-alert.service';
import { ModelCatalogService } from '../../infra/model-catalog/model-catalog.service';

/** Cadence du poll par instance : aligné sur le module performance. */
const POLL_INTERVAL_SECONDS = 300;
/** Pages max par poll : le reste attend le prochain tour (rattrapage progressif). */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
/** Les coûts servent aussi de contrôle face à la facture : rétention longue. */
const RETENTION_DAYS = 365;
const PURGE_EVERY_MS = 24 * 3600 * 1000;

/** Une exécution en cours n'a pas fini de consommer : on attend qu'elle termine. */
const FINISHED_STATUSES = new Set(['success', 'error', 'crashed', 'canceled']);

export interface LlmSampleResult {
  instances: number;
  executions: number;
  calls: number;
  /**
   * De quoi lire un zéro : sans ces trois nombres, « 0 appel » ne dit pas si
   * aucun workflow ne parle à un modèle, si aucune exécution n'est arrivée, ou
   * si les exécutions inspectées ne portaient pas de consommation (sortie
   * simplifiée du nœud OpenAI, exécutions non enregistrées par n8n…).
   */
  candidateWorkflows: number;
  inspectedExecutions: number;
  /** Workflows inspectés dont AUCUNE exécution n'a rendu de consommation, avec le coupable probable. */
  silentWorkflows: SilentWorkflow[];
}

export interface SilentWorkflow {
  /** Id en base, pour ouvrir la fiche. */
  id: string;
  name: string;
  instanceName: string;
  inspectedExecutions: number;
  /** Nœuds dont l'option « Simplify Output » est active : la cause probable, et le correctif. */
  simplifiedNodes: string[];
  /** Nœuds surveillés (vendeur ou HTTP) quand aucune cause n'est identifiée. */
  watchedNodes: string[];
}

interface Candidate {
  id: string;
  name: string;
  langchain: boolean;
  httpNodes: string[];
  simplifiedNodes: string[];
}

/**
 * Poll des exécutions pour en extraire la consommation LLM, curseur par instance
 * comme le module performance ; la baseline balaie jusqu'à MAX_PAGES pages. La
 * liste est un poll léger : seules les exécutions des workflows qui portent un
 * nœud modèle LangChain ou un HTTP Request vers un provider LLM déclenchent le
 * fetch détaillé (`includeData=true`, lourd).
 * Le coût est figé à l'ingestion avec la table de tarifs du moment.
 */
@Injectable()
export class LlmUsageSamplerService {
  private readonly logger = new Logger(LlmUsageSamplerService.name);
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly prices: ModelCatalogService,
    private readonly budget: BudgetAlertService,
    @Inject(N8N_API_PORT) private readonly n8nApi: N8nApiPort,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(AI_COST_MANIFEST.id))) return;
    await this.sampleDueInstances();
    await this.purgeIfDue();
  }

  async sampleDueInstances(force = false): Promise<LlmSampleResult> {
    const instances = await this.prisma.instance.findMany();
    const now = Date.now();
    const result: LlmSampleResult = {
      instances: 0,
      executions: 0,
      calls: 0,
      candidateWorkflows: 0,
      inspectedExecutions: 0,
      silentWorkflows: [],
    };

    for (const instance of instances) {
      const cursor = await this.prisma.llmUsageCursor.findUnique({
        where: { instanceId: instance.id },
      });
      if (!force && !isCheckDue(cursor?.lastPolledAt, POLL_INTERVAL_SECONDS, now)) continue;
      // Forcer sans aucune donnée = refaire la passe profonde : les appels LLM sont
      // rares, une baseline qui n'a rien vu ne prouve pas qu'il n'y a rien.
      const redoBaseline =
        force && (await this.prisma.llmUsage.count({ where: { instanceId: instance.id } })) === 0;
      result.instances++;
      try {
        const sampled = await this.sampleInstance(
          instance,
          redoBaseline ? undefined : (cursor?.lastSeenExecutionId ?? undefined),
        );
        result.executions += sampled.executions;
        result.calls += sampled.calls;
        result.candidateWorkflows += sampled.candidateWorkflows;
        result.inspectedExecutions += sampled.inspectedExecutions;
        result.silentWorkflows.push(
          ...sampled.silentWorkflows.map((w) => ({ ...w, instanceName: instance.name })),
        );
      } catch (error) {
        // Instance en panne : le curseur n'a pas bougé, tout sera repris au retour.
        this.logger.warn(`AI cost poll failed for ${instance.name}: ${(error as Error).message}`);
      }
    }
    if (result.instances > 0) await this.budget.checkToday();
    return result;
  }

  private async sampleInstance(
    instance: { id: string; baseUrl: string; apiKey: string },
    lastSeenId: string | undefined,
  ): Promise<{
    executions: number;
    calls: number;
    candidateWorkflows: number;
    inspectedExecutions: number;
    silentWorkflows: Omit<SilentWorkflow, 'instanceName'>[];
  }> {
    // Premier passage compris : la baseline balaie MAX_PAGES pages — les appels LLM
    // sont rares, une seule page les manquerait presque toujours, et le fetch lourd
    // reste borné aux exécutions des workflows candidats.
    const fresh: N8nExecutionSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.n8nApi.listAllExecutions(instance, { limit: PAGE_SIZE, cursor });
      const newOnes =
        lastSeenId === undefined
          ? result.executions
          : result.executions.filter((e) => BigInt(e.id) > BigInt(lastSeenId));
      fresh.push(...newOnes);
      if (newOnes.length < result.executions.length || !result.nextCursor) break;
      cursor = result.nextCursor;
    }

    const maxSeenId = fresh.reduce((max, e) => (BigInt(e.id) > BigInt(max) ? e.id : max), lastSeenId ?? '0');

    const candidates = await this.llmWorkflows(instance.id);
    const toInspect = fresh.filter(
      (e) => FINISHED_STATUSES.has(e.status) && e.startedAt && candidates.has(e.workflowId),
    );

    const pricer = toInspect.length > 0 ? await this.prices.pricer() : null;
    let calls = 0;
    const inspected = new Map<string, { runs: number; readable: number }>();
    for (const execution of toInspect) {
      const candidate = candidates.get(execution.workflowId)!;
      const detail = await this.n8nApi.getExecution(instance, execution.id, { includeData: true });
      const usages = [
        ...(candidate.langchain ? extractLlmUsage(detail.data) : []),
        ...extractHttpLlmUsage(detail.data, candidate.httpNodes),
      ];
      const seen = inspected.get(execution.workflowId) ?? { runs: 0, readable: 0 };
      seen.runs++;
      if (usages.length > 0) seen.readable++;
      inspected.set(execution.workflowId, seen);
      if (usages.length === 0) continue;
      await this.prisma.llmUsage.createMany({
        data: usages.map((usage) => ({
          instanceId: instance.id,
          executionId: execution.id,
          externalWorkflowId: execution.workflowId,
          nodeName: usage.nodeName,
          runIndex: usage.runIndex,
          callIndex: usage.callIndex,
          itemIndex: usage.itemIndex,
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          isEstimate: usage.isEstimate,
          costUsd: pricer!(usage.model, usage),
          startedAt: new Date(execution.startedAt!),
        })),
        skipDuplicates: true,
      });
      calls += usages.length;
    }

    await this.prisma.llmUsageCursor.upsert({
      where: { instanceId: instance.id },
      create: {
        instanceId: instance.id,
        lastSeenExecutionId: maxSeenId === '0' ? null : maxSeenId,
        lastPolledAt: new Date(),
      },
      update: {
        lastSeenExecutionId: maxSeenId === '0' ? null : maxSeenId,
        lastPolledAt: new Date(),
      },
    });
    const silentWorkflows = [...inspected]
      .filter(([, seen]) => seen.readable === 0)
      .map(([externalId, seen]) => {
        const candidate = candidates.get(externalId)!;
        return {
          id: candidate.id,
          name: candidate.name,
          inspectedExecutions: seen.runs,
          simplifiedNodes: candidate.simplifiedNodes,
          watchedNodes: candidate.httpNodes,
        };
      });
    return {
      executions: toInspect.length,
      calls,
      candidateWorkflows: candidates.size,
      inspectedExecutions: toInspect.length,
      silentWorkflows,
    };
  }

  /**
   * Workflows candidats de l'instance : nœud modèle LangChain et/ou HTTP Request
   * vers un provider LLM connu (externalId → ce qu'il faut y chercher).
   */
  private async llmWorkflows(instanceId: string): Promise<Map<string, Candidate>> {
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId },
      select: { id: true, name: true, externalId: true, raw: true },
    });
    const candidates = new Map<string, Candidate>();
    for (const workflow of workflows) {
      const raw = workflow.raw as unknown as N8nWorkflow;
      const langchain = workflowHasLlmNodes(raw);
      const httpNodes = detectLlmOutputNodes(raw);
      if (langchain || httpNodes.length > 0) {
        candidates.set(workflow.externalId, {
          id: workflow.id,
          name: workflow.name,
          langchain,
          httpNodes,
          simplifiedNodes: detectSimplifiedOutputNodes(raw),
        });
      }
    }
    return candidates;
  }

  private async purgeIfDue(): Promise<void> {
    if (Date.now() - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = Date.now();
    const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await this.prisma.llmUsage.deleteMany({
      where: { startedAt: { lt: limit } },
    });
    if (count > 0) this.logger.log(`AI cost purge: ${count} call(s) older than ${RETENTION_DAYS} d`);
  }
}
