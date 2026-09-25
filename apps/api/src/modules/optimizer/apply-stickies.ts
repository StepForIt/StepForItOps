import { randomUUID } from 'node:crypto';
import { N8nNode, N8nWorkflow, computeZoneRect, isStickyNote } from '@nwm/core';

export interface StickyApplySpec {
  action: 'create' | 'update';
  /** Requis pour update : nom de la sticky existante à compléter. */
  stickyName?: string;
  /** Contenu markdown. */
  content: string;
  /** Index couleur n8n (1..7). */
  color?: number;
  /** Requis pour create : nœuds que la nouvelle zone doit couvrir. */
  nodeNames?: string[];
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * Applique des créations/complétions de stickies SANS toucher connections ni pinData.
 * Les specs devenues invalides (sticky disparue, nœuds sans position) sont ignorées :
 * le workflow a pu changer entre la suggestion et l'application.
 */
export function applyStickySpecs(
  workflow: N8nWorkflow,
  specs: StickyApplySpec[],
): { workflow: N8nWorkflow; applied: number } {
  let applied = 0;
  let nodes = [...workflow.nodes];
  const created: N8nNode[] = [];
  const names = new Set(nodes.map((n) => n.name));

  for (const spec of specs) {
    const color = spec.color && spec.color >= 1 && spec.color <= 7 ? spec.color : undefined;

    if (spec.action === 'update' && spec.stickyName) {
      const index = nodes.findIndex((n) => n.name === spec.stickyName && isStickyNote(n));
      if (index === -1) continue;
      nodes[index] = {
        ...nodes[index],
        parameters: {
          ...nodes[index].parameters,
          content: spec.content,
          ...(color ? { color } : {}),
        },
      };
      applied++;
    }

    if (spec.action === 'create') {
      const positions = (spec.nodeNames ?? [])
        .map((name) => nodes.find((n) => n.name === name && !isStickyNote(n))?.position)
        .filter((p): p is [number, number] => !!p);
      if (positions.length === 0) continue;
      const rect = computeZoneRect(positions);
      const name = uniqueName('Note', names);
      names.add(name);
      created.push({
        id: randomUUID(),
        name,
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [rect.x, rect.y],
        parameters: {
          content: spec.content,
          width: rect.width,
          height: rect.height,
          ...(color ? { color } : {}),
        },
      });
      applied++;
    }
  }

  // Stickies en tête du tableau : n8n les rend derrière les nœuds.
  if (created.length > 0) nodes = [...created, ...nodes];
  return { workflow: { ...workflow, nodes }, applied };
}
