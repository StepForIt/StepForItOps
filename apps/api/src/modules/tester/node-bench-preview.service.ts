import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BenchFeed,
  BenchGateVerdict,
  BenchImpact,
  BenchIssue,
  EnvName,
  N8N_API_PORT,
  N8nApiPort,
  N8nExecutionSummary,
  N8nInstanceConfig,
  benchImpacts,
  benchWorkflowName,
  collectNodeItems,
  evaluateBenchGate,
  planNodeBench,
} from '@nwm/core';
import { WorkflowsService } from '../workflows/workflows.service';
import { InstancesService } from '../instances/instances.service';

/** Exécutions relues pour retrouver de vraies données d'entrée. */
const SAMPLE_EXECUTIONS = 5;
/** Items proposés par nœud simulé : de quoi voir la forme, pas de quoi noyer l'écran. */
const SAMPLE_ITEMS = 3;

export interface BenchFeedSuggestion extends BenchFeed {
  /** Items repris des dernières exécutions réelles, à corriger avant lancement. */
  items: Array<Record<string, unknown>>;
  /** `executions` : donnée réelle. `none` : rien trouvé, à saisir à la main. */
  source: 'executions' | 'none';
}

export interface NodeBenchPreview {
  workflowId: string;
  workflowName: string;
  nodeName: string;
  type: string;
  env: EnvName | null;
  active: boolean;
  /** Nom que portera le banc : c'est aussi sa clé de réutilisation. */
  benchName: string;
  feeds: BenchFeedSuggestion[];
  /** Ce qui s'exécutera POUR DE VRAI — rien n'est bouchonné sur un banc. */
  impacts: BenchImpact[];
  issues: BenchIssue[];
  /** Le nœud n'est pas testable (déclencheur, note) : voir `issues`. */
  blocked: boolean;
  gate: BenchGateVerdict;
}

/**
 * Ce qu'un banc d'essai ferait, AVANT de le créer. Deux questions, et c'est
 * tout : qu'est-ce qui va vraiment partir (le banc garde les credentials du
 * nœud — un HTTP en écriture tape la vraie API), et avec quoi le nœud sera
 * nourri (repris des dernières exécutions, plutôt qu'un formulaire vide).
 */
@Injectable()
export class NodeBenchPreviewService {
  private readonly logger = new Logger(NodeBenchPreviewService.name);

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  async preview(workflowId: string, nodeName: string, force = false): Promise<NodeBenchPreview> {
    // Un preview mène à une écriture dans n8n : on repart de n8n, jamais du miroir.
    const { workflow, raw } = await this.workflows.getFreshRaw(workflowId);
    const plan = planNodeBench(raw, nodeName);
    const impacts = plan.blocked ? [] : benchImpacts(raw, plan);

    const feeds = plan.blocked
      ? []
      : await this.suggestFeeds(workflow.instanceId, workflow.externalId, plan.feeds);

    return {
      workflowId,
      workflowName: workflow.name,
      nodeName,
      type: plan.type,
      env: workflow.env,
      active: workflow.active,
      benchName: benchWorkflowName(raw.name, nodeName),
      feeds,
      impacts,
      issues: plan.issues,
      blocked: plan.blocked,
      gate: evaluateBenchGate(impacts, { env: workflow.env, active: workflow.active, force }),
    };
  }

  /**
   * Données d'entrée proposées. L'échec de lecture n'est pas fatal : un banc
   * avec des champs vides reste utilisable, un preview qui plante ne l'est pas.
   */
  private async suggestFeeds(
    instanceId: string,
    externalId: string,
    feeds: BenchFeed[],
  ): Promise<BenchFeedSuggestion[]> {
    let items: Record<string, Array<Record<string, unknown>>> = {};
    try {
      const config = await this.instances.getConfig(instanceId);
      const executions = await this.fetchWithData(config, externalId);
      items = collectNodeItems(
        executions,
        feeds.map((feed) => feed.nodeName),
        SAMPLE_ITEMS,
      );
    } catch (error) {
      this.logger.warn(`Échantillons indisponibles (${externalId}) : ${(error as Error).message}`);
    }

    return feeds.map((feed) => ({
      ...feed,
      items: items[feed.nodeName] ?? [],
      source: items[feed.nodeName]?.length ? 'executions' : 'none',
    }));
  }

  /** `includeData` sur la liste selon les versions de n8n ; repli sur des GET unitaires. */
  private async fetchWithData(
    instance: N8nInstanceConfig,
    externalId: string,
  ): Promise<N8nExecutionSummary[]> {
    const listed = await this.n8n.listExecutions(instance, externalId, SAMPLE_EXECUTIONS, {
      includeData: true,
    });
    if (listed.length === 0 || listed.some((execution) => execution.data !== undefined)) return listed;
    return Promise.all(
      listed.map((execution) =>
        this.n8n.getExecution(instance, execution.id, { includeData: true }).catch(() => execution),
      ),
    );
  }
}
