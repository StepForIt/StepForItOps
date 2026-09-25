import { stableJson } from '../stable-json';
import { N8nNode, N8nWorkflow } from './workflow.types';
import {
  ChangeExplanation,
  explainConnectionChanges,
  explainLeafChanges,
  explainNodeChange,
} from './change-impact';

/** Une ligne de diff unifié : contexte, ajout ou suppression. */
export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  text: string;
}

export interface NodeDiff {
  name: string;
  /** Type n8n du nœud (après changement pour un nœud modifié). */
  nodeType: string;
  change: 'added' | 'removed' | 'modified' | 'renamed';
  /** Ancien nom, pour un nœud renommé. */
  renamedFrom?: string;
  /** Champs du nœud qui diffèrent (parameters, credentials, position…). */
  fields: string[];
  lines: DiffLine[];
  /** Le même changement dit en français : c'est ce qu'on lit, le JSON sert à vérifier. */
  explanations: ChangeExplanation[];
}

export interface WorkflowDiff {
  nameChange: { before: string; after: string } | null;
  nodes: NodeDiff[];
  connections: { changed: boolean; lines: DiffLine[]; explanations: ChangeExplanation[] };
  settings: { changed: boolean; lines: DiffLine[]; explanations: ChangeExplanation[] };
  counts: { added: number; removed: number; modified: number; renamed: number };
  hasChanges: boolean;
}

/** Au-delà de cette taille, le diff ligne à ligne devient coûteux : on bascule en « tout remplacé ». */
const MAX_DIFF_LINES = 1500;

function toLines(value: unknown): string[] {
  if (value === undefined) return [];
  return JSON.stringify(value, null, 2).split('\n');
}

/** Plus longue sous-séquence commune (table de longueurs). */
function lcsLengths(a: string[], b: string[]): Uint32Array[] {
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** Diff unifié (sans troncature) entre deux listes de lignes. */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  if (before.length + after.length > MAX_DIFF_LINES) {
    return [
      ...before.map((text): DiffLine => ({ type: 'del', text })),
      ...after.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }
  const table = lcsLengths(before, after);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ type: 'ctx', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: 'del', text: before[i] });
      i += 1;
    } else {
      lines.push({ type: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ type: 'del', text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ type: 'add', text: after[j] });
    j += 1;
  }
  return lines;
}

/** Diff unifié entre deux valeurs JSON (sérialisées indentées). */
export function diffJson(before: unknown, after: unknown): DiffLine[] {
  return diffLines(toLines(before), toLines(after));
}

function byName(nodes: N8nNode[] | undefined): Map<string, N8nNode> {
  return new Map((nodes ?? []).map((node) => [node.name, node]));
}

/** Ordre d'affichage des champs connus ; les autres suivent, par ordre alphabétique. */
const NODE_FIELDS = [
  'type',
  'typeVersion',
  'parameters',
  'credentials',
  'disabled',
  'onError',
  'notes',
  'notesInFlow',
  'position',
  'webhookId',
];

/**
 * Champs du nœud qui diffèrent — TOUS, pas une liste fermée : un `retryOnFail` ou un
 * `onError` qui bouge change l'exécution autant qu'un paramètre, et un diff qui le tait
 * se lit « rien n'a changé ». L'`id` n'a pas de sens métier, le `name` sert à apparier.
 */
function changedFields(before: N8nNode, after: N8nNode): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete('id');
  keys.delete('name');
  const rank = (key: string): number => {
    const index = NODE_FIELDS.indexOf(key);
    return index === -1 ? NODE_FIELDS.length : index;
  };
  const field = (node: N8nNode, key: string): unknown => (node as unknown as Record<string, unknown>)[key];
  return [...keys]
    .filter((key) => stableJson(field(before, key) ?? null) !== stableJson(field(after, key) ?? null))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Nœud sans son `id` : le diff affiché ne montre que ce qui a du sens pour un humain. */
function displayable(node: N8nNode): Omit<N8nNode, 'id'> {
  const { id: _id, ...rest } = node;
  return rest;
}

export interface DiffOptions {
  /** Forme sous laquelle deux nœuds sont comparés : ce qu'elle efface ne compte pas comme un changement. */
  compareAs?: (node: N8nNode) => N8nNode;
}

/**
 * Compare deux workflows n8n : nœuds ajoutés / supprimés / modifiés (avec diff
 * ligne à ligne), plus les connexions et les réglages.
 */
export function diffWorkflows(
  before: N8nWorkflow,
  after: N8nWorkflow,
  options: DiffOptions = {},
): WorkflowDiff {
  const compared = (a: N8nNode, b: N8nNode): string[] =>
    options.compareAs ? changedFields(options.compareAs(a), options.compareAs(b)) : changedFields(a, b);
  const beforeNodes = byName(before.nodes);
  const afterNodes = byName(after.nodes);
  const nodes: NodeDiff[] = [];
  const added: N8nNode[] = [];

  for (const [name, node] of afterNodes) {
    const previous = beforeNodes.get(name);
    if (!previous) {
      added.push(node);
      continue;
    }
    const fields = compared(previous, node);
    if (fields.length > 0) {
      nodes.push({
        name,
        nodeType: node.type,
        change: 'modified',
        fields,
        lines: diffJson(displayable(previous), displayable(node)),
        explanations: explainNodeChange(previous, node),
      });
    }
  }

  // Un renommage se lit « disparu ici, apparu là » : on le recolle par l'id n8n,
  // stable au renommage — sinon la revue affiche un ajout + une suppression.
  const removed = [...beforeNodes.values()].filter((node) => !afterNodes.has(node.name));
  const renamedFor = new Map<string, N8nNode>();
  for (const node of removed) {
    const match = node.id ? added.find((candidate) => candidate.id === node.id) : undefined;
    if (match) renamedFor.set(match.name, node);
  }

  for (const node of added) {
    const previous = renamedFor.get(node.name);
    nodes.push({
      name: node.name,
      nodeType: node.type,
      change: previous ? 'renamed' : 'added',
      ...(previous ? { renamedFrom: previous.name } : {}),
      fields: previous ? compared(previous, node) : [],
      lines: diffJson(previous ? displayable(previous) : undefined, displayable(node)),
      explanations: explainNodeChange(previous, node),
    });
  }

  const renamedFrom = new Set([...renamedFor.values()].map((node) => node.name));
  for (const node of removed) {
    if (renamedFrom.has(node.name)) continue;
    nodes.push({
      name: node.name,
      nodeType: node.type,
      change: 'removed',
      fields: [],
      lines: diffJson(displayable(node), undefined),
      explanations: explainNodeChange(node, undefined),
    });
  }

  const connectionsChanged =
    JSON.stringify(before.connections ?? {}) !== JSON.stringify(after.connections ?? {});
  const settingsChanged = JSON.stringify(before.settings ?? {}) !== JSON.stringify(after.settings ?? {});
  const nameChange = before.name !== after.name ? { before: before.name, after: after.name } : null;

  const counts = {
    added: nodes.filter((n) => n.change === 'added').length,
    removed: nodes.filter((n) => n.change === 'removed').length,
    modified: nodes.filter((n) => n.change === 'modified').length,
    renamed: nodes.filter((n) => n.change === 'renamed').length,
  };

  return {
    nameChange,
    nodes,
    connections: {
      changed: connectionsChanged,
      lines: connectionsChanged ? diffJson(before.connections ?? {}, after.connections ?? {}) : [],
      explanations: connectionsChanged ? explainConnectionChanges(before.connections, after.connections) : [],
    },
    settings: {
      changed: settingsChanged,
      lines: settingsChanged ? diffJson(before.settings ?? {}, after.settings ?? {}) : [],
      explanations: settingsChanged ? explainLeafChanges(before.settings, after.settings) : [],
    },
    counts,
    hasChanges: nodes.length > 0 || connectionsChanged || settingsChanged || nameChange !== null,
  };
}
