import { nodeClass, type BoxClass } from './map-style';
import type { WorkflowMapLink, WorkflowMapNode } from './types';

/** Ce que la légende explique à cet instant : seulement ce qui est réellement à l'écran. */
export interface LegendContent {
  boxes: BoxClass[];
  arrows: Array<'call' | 'webhook' | 'tool' | 'manual' | 'entry' | 'context'>;
}

/**
 * La légende suit le schéma : une pastille « archivé » devant un parc sans archivé n'apprend rien
 * et noie le reste. Les deux repères de base (une boîte, une flèche « appelle ») restent toujours.
 */
export function legendContent(
  nodes: WorkflowMapNode[],
  links: WorkflowMapLink[],
  showEntryPoints: boolean,
): LegendContent {
  const boxes = new Set<BoxClass>(['workflow']);
  for (const node of nodes) boxes.add(nodeClass(node));
  if (links.some((link) => link.origin === 'auto' && link.fromId === link.toId && isSubCall(link))) {
    boxes.add('subcall');
  }
  const hasEntry = showEntryPoints && nodes.some((node) => (node.entryPoints ?? []).length > 0);
  if (hasEntry) boxes.add('entry');

  const arrows = new Set<LegendContent['arrows'][number]>(['call']);
  for (const link of links) {
    if (link.origin === 'manual') arrows.add('manual');
    else if (link.kind === 'webhook') arrows.add('webhook');
    else if (link.kind === 'tool') arrows.add('tool');
    if (link.context) arrows.add('context');
  }
  if (hasEntry) arrows.add('entry');

  // Ordre stable, celui du schéma : du plus courant au plus rare.
  const boxOrder: BoxClass[] = [
    'workflow',
    'subworkflow',
    'inactive',
    'archived',
    'external',
    'subcall',
    'entry',
  ];
  const arrowOrder: LegendContent['arrows'] = ['call', 'webhook', 'tool', 'manual', 'context', 'entry'];
  return {
    boxes: boxOrder.filter((box) => boxes.has(box)),
    arrows: arrowOrder.filter((arrow) => arrows.has(arrow)),
  };
}

function isSubCall(link: WorkflowMapLink): boolean {
  return link.kind === 'execute' || link.kind === 'tool';
}
