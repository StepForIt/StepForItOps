import { N8nNode, N8nWorkflow } from './workflow.types';
import { WorkflowGraph, isStickyNote, isTriggerNode } from './workflow-graph';
import { WorkflowCall, extractWorkflowCalls } from './workflow-links';
import { msg } from '../../i18n/translate';

function nodeId(name: string, index: Map<string, string>): string {
  if (!index.has(name)) index.set(name, `n${index.size}`);
  return index.get(name)!;
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, '#quot;');
}

function shortType(type: string): string {
  return type.split('.').pop() ?? type;
}

/** Une URL entière déforme la boîte : on garde le début et la fin, qui portent le sens. */
function short(text: string, max = 52): string {
  return text.length <= max ? text : `${text.slice(0, max - 14)}…${text.slice(-12)}`;
}

/** Ce que ce nœud déclenche ailleurs, dit en clair sous son nom. */
function callTarget(call: WorkflowCall): string {
  if (call.kind === 'webhook') return `→ ${short(call.targetUrl ?? `/${call.targetWebhookPath}`)}`;
  const target =
    call.targetLabel ??
    (call.targetN8nId?.includes('{{') ? msg('checks.mermaidDynamicTarget') : `workflow #${call.targetN8nId}`);
  return call.kind === 'tool'
    ? msg('checks.mermaidToolCall', { target: short(target) })
    : `→ ${short(target)}`;
}

function nodeClass(node: N8nNode, calls: Map<string, WorkflowCall>): string {
  if (node.disabled) return ':::disabled';
  if (isTriggerNode(node)) return ':::trigger';
  // `call` est un mot réservé de la syntaxe Mermaid (`click X call …`) : il casse le parseur.
  if (calls.has(node.name)) return ':::outgoing';
  return '';
}

/** Sévérité la plus haute portée par un nœud, pour l'entourer dans le schéma. */
export type MermaidFlag = 'error' | 'warning';

export interface MermaidOptions {
  /** Nœuds à signaler (findings) : nom du nœud → sévérité la plus haute. */
  flagged?: ReadonlyMap<string, MermaidFlag>;
}

/**
 * Génère un flowchart Mermaid depuis un workflow n8n. Les portes d'entrée (triggers) et
 * les nœuds qui déclenchent autre chose (sous-workflow, outil IA, webhook distant) sont
 * mis en couleur, et ces derniers annoncent leur cible : un schéma doit montrer par où
 * on entre et où ça part, pas seulement l'enchaînement interne.
 */
export function workflowToMermaid(workflow: N8nWorkflow, options: MermaidOptions = {}): string {
  const graph = new WorkflowGraph(workflow);
  const ids = new Map<string, string>();
  const lines: string[] = ['flowchart LR'];
  const calls = new Map(extractWorkflowCalls(workflow).map((call) => [call.nodeName, call]));

  const drawn = new Set<string>();
  for (const node of workflow.nodes) {
    if (isStickyNote(node)) continue; // annotations visuelles, pas des étapes
    const id = nodeId(node.name, ids);
    drawn.add(node.name);
    const call = calls.get(node.name);
    const target = call ? `<br/><i>${callTarget(call)}</i>` : '';
    const label = escapeLabel(`${node.name}<br/><i>${shortType(node.type)}</i>${target}`);
    lines.push(`  ${id}["${label}"]${nodeClass(node, calls)}`);
  }

  /**
   * `graph.edges` ne contient que les arêtes dont les deux extrémités existent
   * (les connexions résiduelles vers un nœud supprimé sont écartées en amont,
   * comme le fait n8n). Reste à écarter les extrémités sticky note, non dessinées.
   */
  for (const edge of graph.edges) {
    if (!drawn.has(edge.from) || !drawn.has(edge.to)) continue;
    const from = nodeId(edge.from, ids);
    const to = nodeId(edge.to, ids);
    const needsLabel = edge.outputIndex > 0 || edge.outputType !== 'main';
    const label = needsLabel
      ? `|${edge.outputType === 'main' ? `out ${edge.outputIndex}` : edge.outputType}|`
      : '';
    lines.push(`  ${from} -->${label} ${to}`);
  }
  /**
   * Les findings passent par `class` et non par `:::` : un nœud garde ainsi sa couleur
   * de fond (trigger, appel sortant) et ne reçoit que le contour d'alerte par-dessus.
   */
  const flaggedIds: Record<MermaidFlag, string[]> = { error: [], warning: [] };
  for (const [name, flag] of options.flagged ?? []) {
    if (drawn.has(name)) flaggedIds[flag].push(nodeId(name, ids));
  }
  lines.push('  classDef disabled fill:#eee,stroke:#999,color:#999;');
  lines.push('  classDef trigger fill:#f6ffed,stroke:#52c41a;');
  lines.push('  classDef outgoing fill:#f9f0ff,stroke:#722ed1;');
  lines.push('  classDef findingError stroke:#ff4d4f,stroke-width:3px;');
  lines.push('  classDef findingWarning stroke:#fa8c16,stroke-width:3px;');
  if (flaggedIds.error.length > 0) lines.push(`  class ${flaggedIds.error.join(',')} findingError;`);
  if (flaggedIds.warning.length > 0) lines.push(`  class ${flaggedIds.warning.join(',')} findingWarning;`);
  return lines.join('\n');
}
