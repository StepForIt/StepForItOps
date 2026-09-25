import { N8nWorkflow } from './workflow.types';
import { WorkflowGraph, hasTrigger, isStickyNote } from './workflow-graph';
import { RefReach, classifyRefReach } from './expression-reach';
import { extractNodeRefs } from './expression-refs';
import { activeParameters } from './inert-params';

/**
 * Pourquoi une ref pose problème, dit dans les termes de l'exécution. La branche
 * sœur (`parallel`) n'est pas listée : elle tourne dans la même exécution, la
 * signaler revenait à crier au « node not executed » sur un montage qui marche.
 */
const REACH_PROBLEMS: Partial<Record<RefReach, (node: string, ref: string) => string>> = {
  exclusive: (node, ref) =>
    `"${node}" référence "${ref}", situé sur une branche exclusive du même IF/Switch (risque "node not executed")`,
  downstream: (node, ref) => `"${node}" référence "${ref}", qui s'exécute APRÈS lui`,
  unrelated: (node, ref) =>
    `"${node}" référence "${ref}", qui dépend d'un autre trigger (jamais la même exécution)`,
};

/** Regroupe les refs identiques d'un même nœud (une ref citée à N chemins = 1 entrée). */
function dedupeRefs(refs: Array<{ path: string; ref: string }>): Array<{ ref: string; paths: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const { path, ref } of refs) {
    if (!grouped.has(ref)) grouped.set(ref, []);
    grouped.get(ref)!.push(path);
  }
  return [...grouped.entries()].map(([ref, paths]) => ({ ref, paths }));
}

import { CheckFinding } from '../check-finding';

export type { CheckFinding };

/** Checks structurels purs (sans IA, sans IO). */
export function runStructuralChecks(workflow: N8nWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const graph = new WorkflowGraph(workflow);
  const disabledNodes = new Set(workflow.nodes.filter((n) => n.disabled).map((n) => n.name));

  // Pas de finding sur les connexions résiduelles vers un nœud supprimé : n8n les
  // ignore et les efface au prochain enregistrement ; la perte réelle remonte via
  // le nœud devenu orphelin (check 2).

  // 1. Expressions référençant un nœud absent, désactivé, ou qui n'aura pas tourné.
  // Un finding par (nœud, ref), chemins agrégés. Stickies exclues (leur markdown
  // cite des expressions, et une sticky n'est branchée à rien). `activeParameters`
  // écarte les branches que n8n n'exécute plus (paramètres inertes).
  for (const node of workflow.nodes) {
    if (isStickyNote(node)) continue;
    const refs = dedupeRefs(extractNodeRefs(activeParameters(node)));
    for (const { paths, ref } of refs) {
      const path = paths.join(' ; ');
      if (!graph.nodeNames.has(ref)) {
        findings.push({
          severity: 'error',
          code: 'expression-missing-node',
          message: `"${node.name}" référence le nœud inexistant "${ref}"`,
          nodeName: node.name,
          data: { path, ref },
        });
      } else if (disabledNodes.has(ref)) {
        findings.push({
          severity: 'warning',
          code: 'expression-disabled-node',
          message: `"${node.name}" référence le nœud désactivé "${ref}"`,
          nodeName: node.name,
          data: { path, ref },
        });
      } else {
        const reach = classifyRefReach(graph, node.name, ref);
        const describe = REACH_PROBLEMS[reach];
        if (describe) {
          findings.push({
            severity: 'warning',
            code: 'expression-not-ancestor',
            message: describe(node.name, ref),
            nodeName: node.name,
            data: { path, ref, reach },
          });
        }
      }
    }
  }

  // 2. Nœuds orphelins (un workflow à nœud unique n'en a pas, stickies non comptées)
  const realNodeCount = workflow.nodes.filter((n) => !isStickyNote(n)).length;
  for (const orphan of graph.orphanNodes()) {
    if (realNodeCount > 1) {
      findings.push({
        severity: 'warning',
        code: 'orphan-node',
        message: `Nœud "${orphan}" non connecté`,
        nodeName: orphan,
      });
    }
  }

  // 3. Pas de trigger
  if (!hasTrigger(workflow)) {
    findings.push({
      severity: 'info',
      code: 'no-trigger',
      message: 'Aucun nœud trigger détecté (workflow uniquement manuel ?)',
    });
  }

  return findings;
}
