import {
  N8nApiPort,
  N8nExecutionSummary,
  N8nInstanceConfig,
  N8nWorkflow,
  N8N_CAPABILITIES,
  PlatformCapabilities,
  PlatformExecution,
  PlatformExecutionsPage,
  PlatformInstanceConfig,
  PlatformWorkflow,
  WorkflowPlatformPort,
} from '@nwm/core';

/**
 * n8n vu par le port commun : la traduction, et rien d'autre.
 *
 * L'adapter n8n complet (`N8nApiAdapter`) reste la voie normale pour tout ce qui
 * est propre à n8n — tags, webhooks, types de nœuds, `includeData`. Cette
 * enveloppe ne sert qu'à ce que le miroir puisse être écrit une seule fois pour
 * les deux plateformes ; elle ne cache rien et n'ajoute aucun comportement.
 */
export class N8nPlatformAdapter implements WorkflowPlatformPort {
  readonly platform = 'n8n' as const;

  constructor(private readonly api: N8nApiPort) {}

  capabilities(): PlatformCapabilities {
    return N8N_CAPABILITIES;
  }

  async listWorkflows(instance: PlatformInstanceConfig): Promise<PlatformWorkflow[]> {
    const workflows = await this.api.listWorkflows(toN8n(instance));
    return workflows.map(toPlatformWorkflow);
  }

  async getWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<PlatformWorkflow> {
    return toPlatformWorkflow(await this.api.getWorkflow(toN8n(instance), externalId));
  }

  /** Le contenu n'est pas relu : c'est un JSON n8n parce qu'il vient d'une instance n8n. */
  async updateWorkflow(instance: PlatformInstanceConfig, externalId: string, raw: unknown): Promise<void> {
    await this.api.updateWorkflow(toN8n(instance), externalId, raw as N8nWorkflow);
  }

  async setActive(instance: PlatformInstanceConfig, externalId: string, active: boolean): Promise<void> {
    await this.api.activateWorkflow(toN8n(instance), externalId, active);
  }

  async deleteWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<void> {
    await this.api.deleteWorkflow(toN8n(instance), externalId);
  }

  /** n8n range ses exécutions à plat : `workflowExternalId` ne sert qu'à Make. */
  async getExecution(
    instance: PlatformInstanceConfig,
    opts: { workflowExternalId: string; executionExternalId: string },
  ): Promise<PlatformExecution | null> {
    const execution = await this.api.getExecution(toN8n(instance), opts.executionExternalId, {
      includeData: true,
    });
    return toPlatformExecution(execution);
  }

  async listExecutions(
    instance: PlatformInstanceConfig,
    opts?: { workflowExternalId?: string; cursor?: string; limit?: number },
  ): Promise<PlatformExecutionsPage> {
    // n8n liste tout le parc d'un coup ; le filtre par workflow n'est qu'une
    // commodité, là où Make n'a que ça.
    if (opts?.workflowExternalId) {
      const executions = await this.api.listExecutions(toN8n(instance), opts.workflowExternalId, opts.limit);
      return { executions: executions.map(toPlatformExecution) };
    }
    const page = await this.api.listAllExecutions(toN8n(instance), {
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return { executions: page.executions.map(toPlatformExecution), nextCursor: page.nextCursor };
  }
}

/**
 * `zone`, `orgId` et `teamId` sont ignorés : ils n'ont de sens que pour Make, et
 * une instance n8n n'en porte jamais.
 */
function toN8n(instance: PlatformInstanceConfig): N8nInstanceConfig {
  return { baseUrl: instance.baseUrl, apiKey: instance.apiKey };
}

function toPlatformWorkflow(workflow: N8nWorkflow): PlatformWorkflow {
  return {
    externalId: workflow.id ?? '',
    name: workflow.name,
    active: workflow.active ?? false,
    tags: tagNames(workflow.tags),
    archivedUpstream: workflow.isArchived === true,
    raw: workflow,
  };
}

/** n8n rend ses tags tantôt en objets, tantôt en chaînes, selon la route. */
function tagNames(tags: N8nWorkflow['tags']): string[] {
  if (!tags) return [];
  return tags.map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean);
}

function toPlatformExecution(execution: N8nExecutionSummary): PlatformExecution {
  return {
    externalId: execution.id,
    workflowExternalId: execution.workflowId,
    status: toStatus(execution.status),
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
  };
}

/**
 * n8n a plus de statuts que le port n'en distingue (`crashed`, `new`, `canceled`…)
 * et le port les rabat sur les quatre qui décident de quelque chose ici. Un
 * statut inconnu est traité comme un ÉCHEC et jamais comme un succès : se taire
 * sur une exécution qu'on n'a pas su lire est le seul travers vraiment coûteux.
 */
function toStatus(status: string): PlatformExecution['status'] {
  if (status === 'success') return 'success';
  if (status === 'running' || status === 'new') return 'running';
  if (status === 'waiting') return 'waiting';
  return 'error';
}
