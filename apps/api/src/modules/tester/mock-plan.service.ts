import { Injectable } from '@nestjs/common';
import { N8nWorkflow, SideEffectNode, detectSideEffects, extractSubWorkflowRefs } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';

export interface MockCandidate extends SideEffectNode {
  /** Pré-coché : ce nœud partira bouchonné sauf décision contraire. */
  suggested: boolean;
  /** Pourquoi il n'est PAS pré-coché, quand c'est le cas. */
  exemption?: string;
  /** Nom du sous-workflow appelé (`kind: 'sub-workflow'` uniquement). */
  targetName?: string;
}

export interface MockPlan {
  workflowName: string;
  candidates: MockCandidate[];
}

/**
 * Ce qu'un test devrait bouchonner. Le défaut penche du côté sûr : tout ce qui
 * sort est pré-coché, sauf ce qu'un mapping env sait rebrancher sur des données
 * de dev — là, exécuter pour de vrai a du sens, c'est même l'intérêt du mapping.
 */
@Injectable()
export class MockPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async plan(workflowId: string): Promise<MockPlan> {
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const json = raw as unknown as N8nWorkflow;

    const mappedIds = await this.mappedIds();
    const subNames = await this.subWorkflowNames(workflow.instanceId, json);

    const candidates = detectSideEffects(json).map((node): MockCandidate => {
      // Un nœud dont la ressource est mappée peut tourner pour de vrai sur les
      // données de dev : le bouchonner d'office ferait perdre le test utile.
      const serialized = JSON.stringify(json.nodes.find((n) => n.name === node.nodeName) ?? {});
      const mapped = node.kind === 'data-write' && [...mappedIds].some((id) => serialized.includes(id));
      return {
        ...node,
        suggested: !mapped,
        exemption: mapped ? 'ressource mappée : bascule l’env plutôt que de bouchonner' : undefined,
        targetName: subNames.get(node.nodeName),
      };
    });

    return { workflowName: workflow.name, candidates };
  }

  /** Tous les ids connus des mappings, tous envs confondus. */
  private async mappedIds(): Promise<Set<string>> {
    const mappings = await this.prisma.resourceMapping.findMany({ select: { values: true } });
    const ids = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value === 'string' && value.length >= 4) ids.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    mappings.forEach((mapping) => walk(mapping.values));
    return ids;
  }

  /** Nom lisible du sous-workflow appelé par chaque nœud d'appel. */
  private async subWorkflowNames(instanceId: string, json: N8nWorkflow): Promise<Map<string, string>> {
    const refs = extractSubWorkflowRefs(json);
    if (refs.length === 0) return new Map();
    const known = await this.prisma.workflow.findMany({
      where: { instanceId, externalId: { in: refs.map((ref) => ref.externalId) } },
      select: { externalId: true, name: true },
    });
    const byId = new Map(known.map((row) => [row.externalId, row.name]));
    return new Map(
      refs.map((ref) => [
        ref.nodeName,
        byId.get(ref.externalId) ?? ref.label ?? `workflow n8n #${ref.externalId}`,
      ]),
    );
  }
}
