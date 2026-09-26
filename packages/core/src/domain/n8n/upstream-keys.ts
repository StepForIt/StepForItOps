/**
 * Ce qu'un nœud en « Map Automatically » écrit réellement : les clés des items
 * qu'il reçoit. La pratique de la maison les pose dans un nœud Set en amont —
 * une seule écriture en auto-map derrière deux Set qui décrivent chacun leur
 * comportement, plutôt que deux branches d'écriture. Pour savoir quelles
 * colonnes la table distante doit porter, il faut donc remonter le graphe
 * jusqu'à ces Set, à travers les nœuds qui laissent passer les items tels quels.
 *
 * Fail-safe : tout ce qui produit des clés impossibles à connaître sans
 * exécuter (Set en JSON, nom calculé, nœud HTTP ou Code, déclencheur) rend
 * `complete: false`. Les clés connues restent certaines — un Set qui les pose
 * les envoie —, ce sont les AUTRES qu'on ne sait pas lister.
 */

import { N8nNode, N8nWorkflow } from './workflow.types';
import { WorkflowGraph } from './workflow-graph';
import { msg } from '../../i18n/translate';

/** Une clé d'item et le Set qui la pose. */
export interface UpstreamKey {
  name: string;
  setNode: string;
}

export interface UpstreamKeys {
  keys: UpstreamKey[];
  /** false = une partie des clés reçues n'est pas déductible du JSON. */
  complete: boolean;
  /** Pourquoi `complete` est faux, un motif par source inconnue. */
  unknownSources: Array<{ nodeName: string; reason: string }>;
}

type Params = Record<string, unknown>;

/**
 * Nœuds qui transmettent les items sans en changer les clés. Merge en fait
 * partie : quel que soit son mode, il ne sort que des clés reçues sur ses
 * entrées, et l'union des parents les couvre toutes.
 */
const PASS_THROUGH = [
  'if',
  'switch',
  'filter',
  'noop',
  'merge',
  'wait',
  'splitinbatches',
  'limit',
  'removeduplicates',
  'sort',
  'executiondata',
];

function isObject(value: unknown): value is Params {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shortType(node: N8nNode): string {
  const dot = node.type.lastIndexOf('.');
  return (dot >= 0 ? node.type.slice(dot + 1) : node.type).toLowerCase();
}

function isSetNode(node: N8nNode): boolean {
  return shortType(node) === 'set';
}

function isPassThrough(node: N8nNode): boolean {
  return PASS_THROUGH.includes(shortType(node));
}

/** `a.b` pose la clé racine `a` — sauf si la notation pointée est coupée. */
function rootKey(name: string, dotNotation: boolean): string {
  return dotNotation ? name.split('.')[0] : name;
}

function isExpression(name: string): boolean {
  return name.startsWith('=') || name.includes('{{');
}

function csv(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

/** Ce que pose un Set, et s'il laisse passer le reste de l'item reçu. */
interface SetOutput {
  names: string[];
  /** Au moins un nom est calculé : la liste est incomplète. */
  dynamic: boolean;
  raw: boolean;
  /** `all` : garde tout l'item reçu ; `selected` : seulement `kept` ; `except` : tout sauf `dropped`. */
  passes: 'none' | 'all' | 'selected' | 'except';
  kept: string[];
  dropped: string[];
}

function setOutput(node: N8nNode): SetOutput {
  const params = node.parameters ?? {};
  const options = isObject(params.options) ? params.options : {};
  const dotNotation = options.dotNotation !== false;
  const output: SetOutput = {
    names: [],
    dynamic: false,
    raw: params.mode === 'raw',
    passes: 'none',
    kept: [],
    dropped: [],
  };

  const entries: unknown[] = [];
  if (isObject(params.assignments) && Array.isArray(params.assignments.assignments)) {
    entries.push(...params.assignments.assignments);
  } else if (isObject(params.fields) && Array.isArray(params.fields.values)) {
    entries.push(...params.fields.values);
  } else if (isObject(params.values)) {
    // v1/v2 : les affectations sont rangées par type (`string`, `number`…).
    for (const group of Object.values(params.values)) if (Array.isArray(group)) entries.push(...group);
  }
  for (const entry of entries) {
    const name = isObject(entry) && typeof entry.name === 'string' ? entry.name : '';
    if (!name) continue;
    if (isExpression(name)) output.dynamic = true;
    else output.names.push(rootKey(name, dotNotation));
  }

  const version = node.typeVersion ?? 1;
  if (version < 3) {
    // Avant la v3, garder le reste de l'item est le défaut.
    output.passes = params.keepOnlySet === true ? 'none' : 'all';
  } else if (version >= 3.3) {
    if (params.includeOtherFields === true) output.passes = modeOf(params.include) ?? 'all';
  } else {
    output.passes = modeOf(params.include) ?? 'none';
  }
  output.kept = csv(params.includeFields);
  output.dropped = csv(params.excludeFields);
  return output;
}

function modeOf(value: unknown): SetOutput['passes'] | undefined {
  return value === 'none' || value === 'all' || value === 'selected' || value === 'except'
    ? value
    : undefined;
}

interface Walk {
  keys: Map<string, UpstreamKey>;
  unknown: Map<string, string>;
}

function addKey(walk: Walk, name: string, setNode: string): void {
  if (!walk.keys.has(name)) walk.keys.set(name, { name, setNode });
}

/**
 * Clés sortant de `nodeName`. `seen` coupe les boucles (Loop Over Items se
 * rebranche sur lui-même) : un nœud déjà visité n'apporte rien de nouveau.
 */
function collect(
  graph: WorkflowGraph,
  byName: Map<string, N8nNode>,
  nodeName: string,
  walk: Walk,
  seen: Set<string>,
): void {
  if (seen.has(nodeName)) return;
  seen.add(nodeName);
  const node = byName.get(nodeName);
  if (!node) return;

  if (isPassThrough(node)) {
    const parents = [...graph.parentsOf(nodeName)].filter((parent) => byName.has(parent));
    if (parents.length === 0) walk.unknown.set(nodeName, msg('checks.upstreamNoParent'));
    for (const parent of parents) collect(graph, byName, parent, walk, seen);
    return;
  }

  if (!isSetNode(node)) {
    walk.unknown.set(nodeName, msg('checks.upstreamOwnData'));
    return;
  }

  const output = setOutput(node);
  if (output.raw) {
    walk.unknown.set(nodeName, msg('checks.upstreamSetRaw'));
    return;
  }
  for (const name of output.names) addKey(walk, name, nodeName);
  if (output.dynamic) walk.unknown.set(nodeName, msg('checks.upstreamDynamicName'));

  if (output.passes === 'none') return;
  if (output.passes === 'selected') {
    for (const name of output.kept) addKey(walk, name, nodeName);
    return;
  }
  // `all` ou `except` : le reste de l'item vient d'en amont.
  const upstream: Walk = { keys: new Map(), unknown: new Map() };
  for (const parent of graph.parentsOf(nodeName)) collect(graph, byName, parent, upstream, seen);
  for (const key of upstream.keys.values()) {
    if (output.passes === 'except' && output.dropped.includes(key.name)) continue;
    addKey(walk, key.name, key.setNode);
  }
  for (const [name, reason] of upstream.unknown) walk.unknown.set(name, reason);
}

/** Clés des items qui arrivent sur `nodeName`, union de toutes ses entrées. */
export function upstreamKeys(workflow: N8nWorkflow, nodeName: string): UpstreamKeys {
  const graph = new WorkflowGraph(workflow);
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const walk: Walk = { keys: new Map(), unknown: new Map() };
  const seen = new Set<string>([nodeName]);
  const parents = [...graph.parentsOf(nodeName)];
  if (parents.length === 0) walk.unknown.set(nodeName, msg('checks.upstreamNoParent'));
  for (const parent of parents) collect(graph, byName, parent, walk, seen);
  return {
    keys: [...walk.keys.values()],
    complete: walk.unknown.size === 0,
    unknownSources: [...walk.unknown].map(([name, reason]) => ({ nodeName: name, reason })),
  };
}
