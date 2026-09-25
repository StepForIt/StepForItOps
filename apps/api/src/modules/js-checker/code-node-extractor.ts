import { N8nWorkflow, activeParameters } from '@nwm/core';

export interface CodeNode {
  nodeName: string;
  nodeType: string;
  code: string;
  /** runOnceForAllItems | runOnceForEachItem (nœud Code moderne) */
  mode: string;
}

const CODE_NODE_TYPES = ['n8n-nodes-base.code', 'n8n-nodes-base.function', 'n8n-nodes-base.functionItem'];

/**
 * Extrait les nœuds contenant du JavaScript utilisateur. Un `jsCode` laissé par
 * n8n sous un nœud Code repassé en Python n'est plus exécuté : `activeParameters`
 * l'écarte (cf. `inert-params.ts`).
 */
export function extractCodeNodes(workflow: N8nWorkflow): CodeNode[] {
  const nodes: CodeNode[] = [];
  for (const node of workflow.nodes) {
    if (!CODE_NODE_TYPES.includes(node.type)) continue;
    const p = activeParameters(node);
    const code = (p['jsCode'] ?? p['functionCode'] ?? '') as string;
    if (!code || typeof code !== 'string') continue;
    nodes.push({
      nodeName: node.name,
      nodeType: node.type,
      code,
      mode: (p['mode'] as string) ?? 'runOnceForAllItems',
    });
  }
  return nodes;
}
