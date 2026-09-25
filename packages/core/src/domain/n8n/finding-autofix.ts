/**
 * Correctifs que la règle sait écrire seule, sans IA — pur et sans IO.
 *
 * Seuls les cas où la correction ne demande AUCUN choix : pas de valeur à
 * inventer (un timeout, un secret), pas de nœud à deviner. Dès qu'il y a deux
 * lectures possibles, on rend `null` et le finding garde « Corriger (IA) ».
 *
 * Le correctif est recalculé sur le workflow COURANT, jamais figé au moment de
 * l'analyse : des opérations calculées hier sur un nœud modifié depuis
 * écraseraient la modification. Le finding ne porte donc qu'un drapeau
 * (`data.autoFix`), posé par la même fonction.
 */

import { CheckFinding } from '../check-finding';
import { WorkflowEditOperation } from './workflow-edit';
import { WorkflowGraph } from './workflow-graph';
import { N8nWorkflow } from './workflow.types';

const MAIN = 'main';
const DONE_OUTPUT = 0;
const LOOP_OUTPUT = 1;

type FindingLike = Pick<CheckFinding, 'code' | 'nodeName' | 'data'>;

export function autoFixOperations(
  workflow: N8nWorkflow,
  finding: FindingLike,
): WorkflowEditOperation[] | null {
  if (!finding.nodeName) return null;
  switch (finding.code) {
    case 'loop-body-on-done':
      return moveBodyToLoopOutput(workflow, finding.nodeName);
    case 'loop-not-closed':
      return closeLoop(workflow, finding.nodeName);
    case 'node-unknown-collection-key':
      return renameCollectionKey(workflow, finding.nodeName, finding.data ?? {});
    default:
      return null;
  }
}

/** Pose `data.autoFix` sur les findings que `autoFixOperations` sait corriger. */
export function markAutoFixable<T extends FindingLike>(workflow: N8nWorkflow, findings: T[]): T[] {
  return findings.map((finding) =>
    autoFixOperations(workflow, finding) ? { ...finding, data: { ...finding.data, autoFix: true } } : finding,
  );
}

/**
 * Corps branché sur `done` : seules les cibles dont la branche revient sur le
 * nœud de boucle sont déplacées — c'est ce retour qui prouve que c'est le corps.
 * Une cible qui ne revient pas est peut-être la vraie suite, elle reste.
 */
function moveBodyToLoopOutput(workflow: N8nWorkflow, loopName: string): WorkflowEditOperation[] | null {
  const graph = new WorkflowGraph(workflow);
  const outgoing = graph.edges.filter((e) => e.from === loopName && e.outputType === MAIN);
  if (outgoing.some((e) => e.outputIndex === LOOP_OUTPUT)) return null;

  const targets = workflow.connections?.[loopName]?.[MAIN]?.[DONE_OUTPUT] ?? [];
  const body = targets.filter(
    (target) =>
      graph.nodeNames.has(target.node) &&
      (target.node === loopName || graph.descendantsOf(target.node).has(loopName)),
  );
  if (body.length === 0) return null;

  return [
    ...body.map((target): WorkflowEditOperation => ({ op: 'disconnect', from: loopName, to: target.node })),
    ...body.map((target): WorkflowEditOperation => ({
      op: 'connect',
      from: loopName,
      to: target.node,
      fromOutput: LOOP_OUTPUT,
      toInput: target.index ?? 0,
    })),
  ];
}

/** Branche `loop` ouverte : refermée seulement s'il n'y a qu'UN bout possible. */
function closeLoop(workflow: N8nWorkflow, loopName: string): WorkflowEditOperation[] | null {
  const loop = workflow.nodes.find((node) => node.name === loopName);
  if (!loop) return null;
  const bodyOutput = (loop.typeVersion ?? 1) >= 3 ? LOOP_OUTPUT : DONE_OUTPUT;
  const graph = new WorkflowGraph(workflow);
  const reached = graph.reachableFromOutput(loopName, MAIN, bodyOutput);
  if (reached.size === 0 || reached.has(loopName)) return null;

  const leaves = [...reached].filter(
    (name) => !graph.edges.some((e) => e.from === name && e.outputType === MAIN),
  );
  if (leaves.length !== 1) return null;
  return [{ op: 'connect', from: leaves[0]!, to: loopName }];
}

/**
 * Sous-clé non déclarée : renommée seulement quand il n'y a qu'une clé fautive
 * et qu'un seul nom admis. Deux noms admis, c'est un choix ; une clé déjà prise
 * sous le nom admis, c'est une fusion — dans les deux cas, pas ici.
 */
function renameCollectionKey(
  workflow: N8nWorkflow,
  nodeName: string,
  data: Record<string, unknown>,
): WorkflowEditOperation[] | null {
  const path = typeof data.path === 'string' ? data.path : null;
  const unknown = Array.isArray(data.unknownKeys) ? data.unknownKeys : [];
  const expected = Array.isArray(data.expectedKeys) ? data.expectedKeys : [];
  if (!path || unknown.length !== 1 || expected.length !== 1) return null;
  const [from, to] = [String(unknown[0]), String(expected[0])];

  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node?.parameters) return null;
  const parameters = JSON.parse(JSON.stringify(node.parameters)) as Record<string, unknown>;
  const holders = objectsAt(
    parameters,
    path.split('.').map((segment) => segment.replace(/\[\]$/, '')),
  );
  const touched = holders.filter((holder) => from in holder);
  if (touched.length === 0 || touched.some((holder) => to in holder)) return null;

  for (const holder of touched) {
    // Reconstruit l'objet pour garder l'ordre des clés : le diff ne montre que le renommage.
    const entries = Object.entries(holder).map(([key, value]) => [key === from ? to : key, value] as const);
    for (const key of Object.keys(holder)) delete holder[key];
    Object.assign(holder, Object.fromEntries(entries));
  }
  return [{ op: 'set-node-parameters', node: nodeName, parameters }];
}

/** Les objets désignés par le chemin ; un tableau rencontré en route vaut chacun de ses items. */
function objectsAt(root: unknown, segments: string[]): Record<string, unknown>[] {
  let current: unknown[] = [root];
  for (const segment of segments) {
    current = current
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => (isObject(value) ? value[segment] : undefined))
      .filter((value) => value !== undefined);
  }
  return current.flatMap((value) => (Array.isArray(value) ? value : [value])).filter(isObject);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
