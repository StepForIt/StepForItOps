import { BRAND } from '../../lib/brand/colors';
import type { WorkflowMapNode } from './types';

/**
 * Le style des boîtes de la carte, écrit UNE fois : le schéma en tire ses `classDef` Mermaid et la
 * légende ses pastilles. Deux copies finiraient par diverger au premier changement de couleur, et
 * une légende qui ment est pire que pas de légende.
 */
export interface BoxStyle {
  fill: string;
  stroke: string;
  color?: string;
  dashed?: boolean;
}

export const BOX_STYLES = {
  workflow: { fill: BRAND.primarySoft, stroke: BRAND.primary },
  inactive: { fill: '#fafafa', stroke: '#bfbfbf', color: '#8c8c8c' },
  archived: { fill: '#f5f5f5', stroke: '#d9d9d9', color: '#8c8c8c', dashed: true },
  external: { fill: '#fff7e6', stroke: '#fa8c16', dashed: true },
  subworkflow: { fill: '#f9f0ff', stroke: '#722ed1' },
  subcall: { fill: '#f9f0ff', stroke: '#722ed1', dashed: true },
  entry: { fill: '#f6ffed', stroke: '#52c41a', color: '#389e0d', dashed: true },
} as const satisfies Record<string, BoxStyle>;

export type BoxClass = keyof typeof BOX_STYLES;

/** Les lignes `classDef` du flowchart. */
export function classDefLines(): string[] {
  return (Object.entries(BOX_STYLES) as Array<[BoxClass, BoxStyle]>).map(([name, style]) => {
    const parts = [`fill:${style.fill}`, `stroke:${style.stroke}`];
    if (style.color) parts.push(`color:${style.color}`);
    if (style.dashed) parts.push('stroke-dasharray: 4 4');
    return `  classDef ${name} ${parts.join(',')};`;
  });
}

/** Ne tourne jamais seul : hors bouton de test, il ne démarre que sur appel d'un autre workflow. */
export function isSubWorkflowOnly(node: WorkflowMapNode): boolean {
  const real = (node.triggers ?? []).filter((kind) => kind !== 'manual');
  return real.length === 1 && real[0] === 'sub-workflow';
}

/** Ce que le workflow est sur la carte — c'est ce qui donne sa couleur à sa boîte. */
export function nodeClass(node: WorkflowMapNode): BoxClass {
  if (node.external) return 'external';
  if (node.archived) return 'archived';
  if (node.active === false) return 'inactive';
  if (isSubWorkflowOnly(node)) return 'subworkflow';
  return 'workflow';
}
