import { Injectable } from '@nestjs/common';
import { CheckFinding, N8nWorkflow, ShapeReference, checkParamShapes, collectShapes } from '@nwm/core';
import { InstanceCorpusService } from './instance-corpus.service';

/**
 * La forme attendue des paramètres, apprise des nœuds de l'instance.
 *
 * `check_workflow` valide le graphe et pas le contenu des paramètres : un
 * `fileUrls` passé en chaîne là où l'éditeur n8n attend un objet est parti sans
 * que rien ne le signale, et n8n n'a plus rouvert le workflow. Faute de schéma de
 * nœud servi par l'API n8n, la norme vient du corpus — les autres nœuds du même
 * type sur la même instance.
 */
@Injectable()
export class InstanceShapesService {
  constructor(private readonly corpus: InstanceCorpusService) {}

  /**
   * Références des seuls types présents dans le workflow examiné : dépouiller
   * tous les types de l'instance pour en utiliser trois serait du gaspillage.
   */
  private async referencesFor(
    instanceId: string,
    workflow: N8nWorkflow,
  ): Promise<Map<string, ShapeReference>> {
    const types = new Set((workflow.nodes ?? []).map((node) => node.type));
    if (types.size === 0) return new Map();
    const raws = await this.corpus.raws(instanceId);
    return new Map([...types].map((type) => [type, collectShapes(raws, type)]));
  }

  /** Écarts de forme d'un workflow, face à ce que l'instance emploie ailleurs. */
  async check(instanceId: string, workflow: N8nWorkflow): Promise<CheckFinding[]> {
    return checkParamShapes(workflow, await this.referencesFor(instanceId, workflow));
  }
}
