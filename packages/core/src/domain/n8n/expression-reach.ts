import { WorkflowGraph } from './workflow-graph';

/**
 * Ce qu'un nœud peut espérer d'une expression `$('Autre')` : n8n ne relit pas le
 * graphe, il relit ce que l'exécution EN COURS a produit. La question n'est donc pas
 * « est-ce un ancêtre ? » mais « ce nœud-là a-t-il pu tourner avant ? ».
 */
export type RefReach =
  /** Ancêtre : sa sortie est là, garantie. */
  | 'ancestor'
  /** Branche sœur qui part du même endroit : les deux branches tournent dans la même exécution. */
  | 'parallel'
  /** Branches exclusives d'un même IF/Switch : l'une exclut l'autre. */
  | 'exclusive'
  /** Le nœud visé est en aval : il n'a pas encore tourné. */
  | 'downstream'
  /** Aucun tronc commun : deux triggers différents, jamais la même exécution. */
  | 'unrelated';

/** Nœud qui aiguille vers UNE de ses sorties : les autres branches ne tournent pas. */
function isChoiceNode(type: string): boolean {
  const t = type.toLowerCase();
  return t.endsWith('.if') || t.endsWith('.switch');
}

/**
 * Deux nœuds sont exclusifs s'il existe un aiguillage qui mène à l'un et à l'autre par
 * des sorties distinctes, sans qu'aucune sortie ne mène aux deux. Volontairement
 * limité aux IF/Switch : sur un « Loop Over Items », les sorties `loop` et `done`
 * tournent toutes les deux, les déclarer exclusives inventerait un problème.
 */
function areExclusive(graph: WorkflowGraph, a: string, b: string): boolean {
  for (const node of graph.workflow.nodes) {
    if (!isChoiceNode(node.type)) continue;
    const outputsA = graph.outputsReaching(node.name, a);
    const outputsB = graph.outputsReaching(node.name, b);
    if (!outputsA.length || !outputsB.length) continue;
    if (outputsA.some((index) => outputsB.includes(index))) continue;
    return true;
  }
  return false;
}

/**
 * Comment `ref` se situe par rapport à `node`, du point de vue de l'exécution.
 * Seuls `exclusive`, `downstream` et `unrelated` sont des problèmes : une branche
 * sœur d'un même tronc s'exécute dans la même passe, son résultat est lisible.
 */
export function classifyRefReach(graph: WorkflowGraph, node: string, ref: string): RefReach {
  if (ref === node) return 'ancestor';
  const ancestors = graph.ancestorsOf(node);
  if (ancestors.has(ref)) return 'ancestor';
  if (graph.ancestorsOf(ref).has(node)) return 'downstream';

  const refAncestors = graph.ancestorsOf(ref);
  const sharesTrunk = [...refAncestors].some((name) => ancestors.has(name));
  if (!sharesTrunk) return 'unrelated';

  return areExclusive(graph, node, ref) ? 'exclusive' : 'parallel';
}
