/**
 * Câblage des boucles « Loop Over Items » (`splitInBatches`), pur et sans IO.
 *
 * Le nœud a DEUX sorties depuis sa v3, et dans cet ordre : 0 = `done` (ce qui
 * suit la boucle, une fois tous les lots consommés), 1 = `loop` (le corps, joué
 * une fois par lot). L'ordre est contre-intuitif, et le corps se retrouve
 * régulièrement branché sur `done` : n8n ne dit rien, l'éditeur non plus, et le
 * workflow fait UN tour avec le premier lot au lieu de tous les traiter.
 *
 * L'autre moitié de la même erreur est le retour manquant : la branche `loop`
 * DOIT se refermer sur le nœud de boucle, faute de quoi le lot suivant n'est
 * jamais demandé. Les deux ne se voient qu'à l'exécution, sur un workflow qui
 * paraît vert — d'où des findings en `error`.
 */

import { N8nWorkflow } from './workflow.types';
import { WorkflowGraph } from './workflow-graph';
import { msg } from '../../i18n/translate';

export interface LoopWiringFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeName?: string;
  data?: Record<string, unknown>;
}

const DONE_OUTPUT = 0;
const LOOP_OUTPUT = 1;

/** Les deux sorties n'existent qu'à partir de la v3 : avant, le nœud n'en a qu'une. */
const TWO_OUTPUT_VERSION = 3;

/** « Loop Over Items », quel que soit le nom donné au nœud. */
function isLoopNode(node: { type: string }): boolean {
  return node.type.toLowerCase().endsWith('.splitinbatches');
}

/** Checks de câblage des boucles (purs, sans IO). */
export function runLoopWiringChecks(workflow: N8nWorkflow): LoopWiringFinding[] {
  const findings: LoopWiringFinding[] = [];
  const graph = new WorkflowGraph(workflow);

  for (const node of workflow.nodes ?? []) {
    if (!isLoopNode(node) || node.disabled) continue;

    const outputs = new Set(
      graph.edges.filter((e) => e.from === node.name && e.outputType === 'main').map((e) => e.outputIndex),
    );
    // Nœud dont aucune sortie n'est branchée : c'est le check « orphelin » qui le dit.
    if (outputs.size === 0) continue;

    const twoOutputs = (node.typeVersion ?? 1) >= TWO_OUTPUT_VERSION;
    const bodyOutput = twoOutputs ? LOOP_OUTPUT : DONE_OUTPUT;

    if (twoOutputs && !outputs.has(LOOP_OUTPUT)) {
      findings.push({
        severity: 'error',
        code: 'loop-body-on-done',
        message: msg('checks.loopBodyOnDone', { node: node.name }),
        nodeName: node.name,
        data: {
          suggestion: msg('checks.loopBodyOnDoneFix'),
        },
      });
      continue; // Sans branche « loop », parler du retour manquant serait redondant.
    }

    // `reachableFromOutput` fait un parcours sans retour sur ses pas : le nœud de
    // boucle n'y figure que si une arête de la branche y revient vraiment.
    if (!graph.reachableFromOutput(node.name, 'main', bodyOutput).has(node.name)) {
      findings.push({
        severity: 'error',
        code: 'loop-not-closed',
        message: msg('checks.loopNotClosed', { node: node.name }),
        nodeName: node.name,
        data: {
          suggestion: msg('checks.loopNotClosedFix', { node: node.name }),
        },
      });
    }
  }

  return findings;
}
