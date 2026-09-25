/**
 * Sous-workflows appelés par un workflow : lecture et RÉÉCRITURE du paramètre
 * `workflowId` des nœuds Execute Workflow / outil workflow d'un agent.
 *
 * Un id n8n ne vaut que dans l'instance qui l'a émis, et une copie dev qui garde
 * l'id d'origine rappelle le workflow de prod — quand n8n l'y autorise, sinon
 * l'exécution meurt sur « the sub-workflow cannot be called by this workflow ».
 * D'où la réécriture, plutôt qu'un simple remplacement de chaîne : elle ne touche
 * que ce paramètre et remet à jour le nom affiché (`cachedResultName`).
 */
import { N8nNode, N8nWorkflow } from './workflow.types';
import { paramLabel, paramString } from './n8n-params';

/** `execute` = nœud Execute Workflow, `tool` = sous-workflow outil d'un agent IA. */
export type SubWorkflowRefKind = 'execute' | 'tool';

export interface SubWorkflowRef {
  nodeName: string;
  kind: SubWorkflowRefKind;
  /** Id n8n écrit dans le paramètre (ou l'expression, si `dynamic`). */
  externalId: string;
  /** Nom affiché par n8n (`cachedResultName`), à défaut du nom réel côté source. */
  label?: string;
  /** Id construit par expression : aucune cible connue à l'avance, donc rien à remapper. */
  dynamic: boolean;
  disabled: boolean;
}

function refKind(node: N8nNode): SubWorkflowRefKind | null {
  const type = node.type.toLowerCase();
  // Le trigger de sous-workflow porte lui aussi "executeworkflow" dans son type,
  // mais il est l'ENTRÉE de l'appelé : rien à remapper dessus.
  if (type.endsWith('trigger')) return null;
  if (type.includes('toolworkflow')) return 'tool';
  if (type.includes('executeworkflow')) return 'execute';
  return null;
}

export function extractSubWorkflowRefs(workflow: N8nWorkflow): SubWorkflowRef[] {
  const refs: SubWorkflowRef[] = [];
  for (const node of workflow.nodes ?? []) {
    const kind = refKind(node);
    if (!kind) continue;
    const externalId = paramString((node.parameters ?? {})['workflowId']);
    if (!externalId) continue;
    refs.push({
      nodeName: node.name,
      kind,
      externalId,
      label: paramLabel((node.parameters ?? {})['workflowId']),
      dynamic: externalId.includes('{{'),
      // Un nœud désactivé est réécrit comme les autres : il sera réactivé un jour.
      disabled: node.disabled === true,
    });
  }
  return refs;
}

/** Cible d'un remappage : le sous-workflow correspondant côté env/instance visé. */
export interface SubWorkflowTarget {
  externalId: string;
  name?: string;
}

export interface SubWorkflowRewrite {
  nodeName: string;
  from: string;
  to: string;
}

/**
 * Réécrit les `workflowId` dont l'id source figure dans `targets`. Retourne une
 * copie : l'original n'est jamais modifié.
 */
export function remapSubWorkflowRefs(
  workflow: N8nWorkflow,
  targets: Map<string, SubWorkflowTarget>,
): { workflow: N8nWorkflow; rewrites: SubWorkflowRewrite[] } {
  const rewrites: SubWorkflowRewrite[] = [];
  const nodes = (workflow.nodes ?? []).map((node) => {
    if (!refKind(node)) return node;
    const param = (node.parameters ?? {})['workflowId'];
    const current = paramString(param);
    const target = current ? targets.get(current) : undefined;
    if (!current || !target || target.externalId === current) return node;

    rewrites.push({ nodeName: node.name, from: current, to: target.externalId });
    const rewritten =
      param && typeof param === 'object'
        ? {
            ...(param as Record<string, unknown>),
            value: target.externalId,
            ...(target.name ? { cachedResultName: target.name } : {}),
          }
        : target.externalId;
    return { ...node, parameters: { ...(node.parameters ?? {}), workflowId: rewritten } };
  });
  return { workflow: { ...workflow, nodes }, rewrites };
}
