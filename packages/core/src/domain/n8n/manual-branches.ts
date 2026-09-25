import { N8nWorkflow } from './workflow.types';
import { WorkflowGraph, isManualTriggerNode, isTriggerNode } from './workflow-graph';

/**
 * Nœuds qu'aucun trigger actif n'atteint SAUF le bouton « Execute workflow » : la
 * branche de mise au point qu'on garde dans un coin du canvas pour rejouer un cas à
 * la main. Elle n'appartient pas au chemin de production — la juger comme tel fait
 * crier au danger sur un outil de debug (« ce nœud écrase tous les statuts »), ce
 * qu'il fait exprès, et ce que la sticky à côté dit déjà.
 */
export function manualOnlyNodes(workflow: N8nWorkflow, graph = new WorkflowGraph(workflow)): Set<string> {
  const triggers = (workflow.nodes ?? []).filter((n) => !n.disabled && isTriggerNode(n));
  if (!triggers.length) return new Set();

  const manualOnly = new Set<string>();
  for (const node of workflow.nodes ?? []) {
    const ancestors = graph.ancestorsOf(node.name);
    const reaching = triggers.filter((t) => t.name === node.name || ancestors.has(t.name));
    // Aucun trigger en amont : nœud isolé ou branche morte, ce n'est pas le sujet ici.
    if (!reaching.length) continue;
    if (reaching.every((t) => isManualTriggerNode(t))) manualOnly.add(node.name);
  }
  return manualOnly;
}
