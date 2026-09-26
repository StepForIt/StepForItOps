import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nExecutionSummary,
  N8nInstanceConfig,
  NodeSamples,
  collectExecutionSamples,
} from '@nwm/core';

export interface SampledSchema {
  samples: NodeSamples[];
  /** Exécutions effectivement exploitées (avec runData). */
  sampledExecutions: number;
}

/**
 * Récupère les dernières exécutions d'un workflow et en déduit le schéma de sortie
 * de chaque nœud. Toutes les exécutions sont prises (succès ET erreur) : une
 * exécution en erreur a quand même produit des items sur les nœuds amont, et les
 * branches non prises ici le seront sur une autre exécution.
 */
@Injectable()
export class ExecutionSamplerService {
  private readonly logger = new Logger(ExecutionSamplerService.name);

  constructor(@Inject(N8N_API_PORT) private readonly n8n: N8nApiPort) {}

  async sample(instance: N8nInstanceConfig, externalId: string, limit: number): Promise<SampledSchema> {
    const executions = await this.fetchWithData(instance, externalId, limit);
    const samples = collectExecutionSamples(executions);
    return { samples, sampledExecutions: executions.filter((e) => e.data !== undefined).length };
  }

  /**
   * `includeData` sur la liste selon les versions de n8n : si le détail n'est pas
   * renvoyé, on retombe sur un GET par exécution.
   */
  private async fetchWithData(
    instance: N8nInstanceConfig,
    externalId: string,
    limit: number,
  ): Promise<N8nExecutionSummary[]> {
    const listed = await this.n8n.listExecutions(instance, externalId, limit, { includeData: true });
    if (listed.length === 0 || listed.some((execution) => execution.data !== undefined)) return listed;

    this.logger.debug(`includeData ignored by the instance — falling back to ${listed.length} single GETs`);
    const detailed = await Promise.all(
      listed.map((execution) =>
        this.n8n.getExecution(instance, execution.id, { includeData: true }).catch(() => execution),
      ),
    );
    return detailed;
  }
}
