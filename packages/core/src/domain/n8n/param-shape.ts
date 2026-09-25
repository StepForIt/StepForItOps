/**
 * Un paramètre dont la FORME s'écarte de celle qu'ont tous les nœuds de même type
 * sur l'instance.
 *
 * D'où ça vient : `check_workflow` valide le graphe — refs de nœuds, connexions,
 * atteignabilité — et pas le contenu des paramètres. Un nœud Notion écrit
 * `fileUrls: { values: [ … ] }` partout, et un seul reçoit `fileUrls: "={{ … }}"`,
 * une chaîne là où l'éditeur attend un objet. Rien ne l'a signalé, le workflow est
 * parti, et n8n ne l'a plus rouvert.
 *
 * On n'a pas le schéma des nœuds : n8n seul le connaît, et son API publique ne le
 * sert pas. Ce qu'on a, c'est le CORPUS — les autres nœuds du même type sur la
 * même instance. « Onze nœuds Notion mettent un objet ici, celui-ci met une
 * chaîne » n'est pas une preuve, mais c'est le signal qui manquait.
 *
 * Sévérité `warning`, jamais `error` : une heuristique de corpus n'a pas à bloquer
 * une écriture en production. Elle a à être VUE avant qu'on clique.
 */

import { activeParameters } from './inert-params';
import { CheckFinding } from './structural-checks';
import { N8nNode, N8nWorkflow } from './workflow.types';

/** Genre JSON d'une valeur — la granularité à laquelle une forme se compare. */
export type ValueKind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';

function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'number' || type === 'boolean' || type === 'string') return type;
  return 'object';
}

/**
 * Profondeur de parcours. Deux niveaux suffisent aux formes qui cassent
 * (`propertiesUi.propertyValues`, `fileUrls.values`) ; plus bas on décrirait le
 * contenu métier — une URL, un id — qui varie légitimement d'un nœud à l'autre.
 */
const MAX_DEPTH = 3;

/** Chemins d'un objet de paramètres, avec le genre de chaque valeur. */
function walk(value: unknown, prefix: string, depth: number, out: Map<string, ValueKind>): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
  // Les éléments d'un tableau partagent le chemin du tableau : ce sont des
  // occurrences d'une même chose, pas des chemins distincts.
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${prefix}[]`, depth, out);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.set(path, kindOf(child));
    walk(child, path, depth + 1, out);
  }
}

/** Ce que l'instance emploie à chaque chemin, pour un type de nœud donné. */
export interface ShapeReference {
  nodeType: string;
  /** Genres vus à ce chemin, et combien de nœuds les portaient. */
  paths: Map<string, Map<ValueKind, number>>;
  /** Nœuds de ce type dépouillés — ce qui fonde la confiance dans la référence. */
  nodes: number;
}

/**
 * Relève les formes employées par les nœuds d'un type, sur tout un corpus.
 * Lu par `activeParameters` : un paramètre que la config courante masque n'est
 * pas exécuté par n8n, et le compter fabriquerait une norme à partir de code mort.
 */
export function collectShapes(workflows: N8nWorkflow[], nodeType: string): ShapeReference {
  const paths = new Map<string, Map<ValueKind, number>>();
  let nodes = 0;
  for (const workflow of workflows) {
    for (const node of workflow.nodes ?? []) {
      if (node.type !== nodeType) continue;
      nodes += 1;
      const seen = new Map<string, ValueKind>();
      walk(activeParameters(node), '', 1, seen);
      for (const [path, kind] of seen) {
        const kinds = paths.get(path) ?? new Map<ValueKind, number>();
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        paths.set(path, kinds);
      }
    }
  }
  return { nodeType, paths, nodes };
}

/**
 * Occurrences qu'il faut à un chemin pour faire autorité. En dessous, un nœud
 * isolé imposerait sa forme au suivant et chaque nouveauté serait suspecte.
 */
const MIN_WITNESSES = 3;

/** Un écart de forme constaté sur un nœud, avec de quoi le juger. */
export interface ShapeMismatch {
  nodeName: string;
  path: string;
  /** Ce que porte ce nœud. */
  found: ValueKind;
  /** Ce que portent tous les autres, et combien. */
  expected: ValueKind;
  witnesses: number;
}

/**
 * Confronte un nœud à la référence. Ne signale QUE l'unanimité contraire : le
 * chemin est vu au moins `MIN_WITNESSES` fois, toujours du même genre, et jamais
 * du genre qu'a ce nœud. Un chemin qui accepte déjà deux formes ne prouve rien.
 */
export function findShapeMismatches(reference: ShapeReference, node: N8nNode): ShapeMismatch[] {
  if (node.type !== reference.nodeType) return [];
  const mine = new Map<string, ValueKind>();
  walk(activeParameters(node), '', 1, mine);

  const mismatches: ShapeMismatch[] = [];
  for (const [path, found] of mine) {
    const kinds = reference.paths.get(path);
    if (!kinds || kinds.size !== 1) continue;

    const [[expected, witnesses]] = [...kinds.entries()];
    if (expected === found || witnesses < MIN_WITNESSES) continue;
    mismatches.push({ nodeName: node.name, path, found, expected, witnesses });
  }
  return mismatches;
}

const KIND_FR: Record<ValueKind, string> = {
  string: 'une chaîne',
  number: 'un nombre',
  boolean: 'un booléen',
  array: 'une liste',
  object: 'un objet',
  null: 'null',
};

export function describeShapeMismatch(mismatch: ShapeMismatch, nodeType: string): CheckFinding {
  const short = nodeType.split('.').pop() ?? nodeType;
  return {
    severity: 'warning',
    code: 'param-shape',
    nodeName: mismatch.nodeName,
    message:
      `Le paramètre « ${mismatch.path} » vaut ${KIND_FR[mismatch.found]}, alors que ` +
      `les ${mismatch.witnesses} autres nœuds ${short} de l'instance y mettent ` +
      `${KIND_FR[mismatch.expected]}. Une forme que l'éditeur n8n n'attend pas à cet ` +
      `endroit peut le faire échouer à l'ouverture du workflow.`,
  };
}

/**
 * Écarts de forme de tout un workflow candidat, face au corpus de son instance.
 * La référence est fournie par type de nœud : le domaine ne va rien chercher.
 */
export function checkParamShapes(
  workflow: N8nWorkflow,
  references: Map<string, ShapeReference>,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const node of workflow.nodes ?? []) {
    const reference = references.get(node.type);
    if (!reference) continue;
    for (const mismatch of findShapeMismatches(reference, node)) {
      findings.push(describeShapeMismatch(mismatch, node.type));
    }
  }
  return findings;
}
