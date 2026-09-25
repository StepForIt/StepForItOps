import { randomUUID } from 'crypto';
import { MASS_LEAF_LOSS, lostLeafCount } from './change-impact';
import { safeRenameNodes } from './safe-rename';
import { hasTrigger } from './workflow-graph';
import { N8nConnections, N8nNode, N8nWorkflow } from './workflow.types';

/** Nouveau nœud demandé par l'IA (le reste — id, position — est complété par nos soins). */
export interface NewNodeSpec {
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  /**
   * Credentials du nœud, au format n8n (`{ notionApi: { id, name } }`). Sans ce
   * champ, tout nœud ajouté arrivait NU : n8n l'enregistre sans broncher, puis
   * refuse de publier le workflow, et le nœud se voyait à la première exécution.
   * L'assistant les reprend d'un nœud de même type déjà présent — l'API n8n ne
   * listant pas les credentials, c'est la seule source qu'on ait.
   */
  credentials?: Record<string, { id?: string; name?: string }>;
  notes?: string;
  position?: [number, number];
}

/**
 * Opérations d'édition qu'un assistant peut demander.
 * Volontairement restreintes : chacune est appliquée de façon déterministe
 * (connexions et expressions maintenues), aucune réécriture libre du JSON.
 */
export type WorkflowEditOperation =
  | { op: 'set-workflow-name'; name: string }
  | { op: 'rename-node'; node: string; newName: string }
  | { op: 'set-node-parameters'; node: string; parameters: Record<string, unknown> }
  | { op: 'patch-node-parameters'; node: string; parameters: Record<string, unknown> }
  | { op: 'remove-node-parameter'; node: string; path: string | string[] }
  | { op: 'set-node-notes'; node: string; notes: string }
  | { op: 'set-node-disabled'; node: string; disabled: boolean }
  | { op: 'remove-node'; node: string }
  | { op: 'add-node'; node: NewNodeSpec; after?: string; before?: string }
  | { op: 'connect'; from: string; to: string; fromOutput?: number; toInput?: number }
  | { op: 'disconnect'; from: string; to: string };

export interface EditResult {
  workflow: N8nWorkflow;
  /** Problèmes non bloquants constatés sur le résultat (à afficher dans la revue). */
  warnings: string[];
}

/** Opération refusée : message destiné à l'utilisateur (et renvoyé à l'IA pour correction). */
export class WorkflowEditError extends Error {}

const MAIN = 'main';
const X_STEP = 220;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findNode(workflow: N8nWorkflow, name: string): N8nNode {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new WorkflowEditError(`Nœud « ${name} » introuvable dans le workflow`);
  return node;
}

function targetsOf(connections: N8nConnections, from: string, output = 0) {
  return connections[from]?.[MAIN]?.[output] ?? [];
}

function addConnection(
  connections: N8nConnections,
  from: string,
  to: string,
  fromOutput = 0,
  toInput = 0,
): void {
  const byType = (connections[from] ??= {});
  const outputs = (byType[MAIN] ??= []);
  while (outputs.length <= fromOutput) outputs.push([]);
  outputs[fromOutput] ??= [];
  if (!outputs[fromOutput].some((t) => t.node === to && t.index === toInput)) {
    outputs[fromOutput].push({ node: to, type: MAIN, index: toInput });
  }
}

/** Retire toutes les arêtes `from → to`, quel que soit le type/l'index de sortie. */
function removeConnection(connections: N8nConnections, from: string, to: string): void {
  const byType = connections[from];
  if (!byType) return;
  for (const outputs of Object.values(byType)) {
    for (let i = 0; i < outputs.length; i += 1) {
      outputs[i] = (outputs[i] ?? []).filter((t) => t.node !== to);
    }
  }
}

/**
 * Retire un nœud du graphe en recousant la chaîne : chaque prédécesseur récupère
 * les cibles de la sortie `main[0]` du nœud supprimé (comportement n8n).
 */
function unlinkNode(connections: N8nConnections, name: string): void {
  const successors = targetsOf(connections, name);
  delete connections[name];
  for (const byType of Object.values(connections)) {
    for (const outputs of Object.values(byType)) {
      for (let i = 0; i < outputs.length; i += 1) {
        const targets = outputs[i] ?? [];
        if (!targets.some((t) => t.node === name)) continue;
        const kept = targets.filter((t) => t.node !== name);
        for (const successor of successors) {
          if (!kept.some((t) => t.node === successor.node && t.index === successor.index)) {
            kept.push({ ...successor });
          }
        }
        outputs[i] = kept;
      }
    }
  }
}

/** Position d'insertion : à droite du nœud de référence, sinon à droite de tout le monde. */
function insertPosition(workflow: N8nWorkflow, reference?: string): [number, number] {
  const anchor = reference ? workflow.nodes.find((n) => n.name === reference) : undefined;
  if (anchor?.position) return [anchor.position[0] + X_STEP, anchor.position[1]];
  const xs = workflow.nodes.map((n) => n.position?.[0] ?? 0);
  return [xs.length > 0 ? Math.max(...xs) + X_STEP : 0, 0];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fusion RÉCURSIVE des paramètres.
 *
 * Une fusion de premier niveau obligeait à renvoyer l'objet parent entier pour
 * toucher une seule sous-clé — et l'assistant, qui ne peut pas recopier de mémoire
 * un `schema` de resourceMapper de plusieurs centaines de champs, en rendait une
 * version amputée : le nœud repartait dans n8n en redemandant tous ses champs.
 * Les tableaux, eux, sont REMPLACÉS : fusionner index par index laisserait la queue
 * de l'ancien tableau derrière la nouvelle liste, ce qui n'est jamais l'intention.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return clone(patch);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(out[key], value);
  return out;
}

/** `["columns","value","Product Link v2"]`, ou `"columns.value[0].name"` par tolérance. */
function pathSegments(path: string | string[]): string[] {
  const segments = Array.isArray(path)
    ? path.map((segment) => String(segment))
    : String(path ?? '')
        .split('.')
        .flatMap((part) => {
          const [head, ...indexes] = part.split('[');
          return [head, ...indexes.map((index) => index.replace(']', ''))];
        });
  const kept = segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  if (kept.length === 0) throw new WorkflowEditError('Chemin de paramètre vide');
  return kept;
}

/**
 * Une colonne retirée du mapping se marque AUSSI dans le schéma du resourceMapper.
 *
 * n8n distingue deux choses dans un `resourceMapper` : `value` porte ce qui est
 * mappé, `schema[]` la photo des colonnes de la table, chacune avec son drapeau
 * `removed`. Retirer la seule entrée de `value` laisse la colonne « connue mais
 * pas encore mappée » : au prochain « Refresh » de l'éditeur, n8n la remet avec
 * toutes les autres, et le champ qu'on venait d'enlever revient.
 *
 * Rien de spécifique à un provider : c'est la forme standardisée par n8n, la même
 * que lit `resource-fields.ts`.
 */
function markRemovedInSchema(container: unknown, field: string): void {
  if (!isPlainObject(container) || !Array.isArray(container.schema)) return;
  for (const entry of container.schema) {
    if (!isPlainObject(entry)) continue;
    if (entry.id === field || entry.displayName === field) entry.removed = true;
  }
}

/** Retire la feuille (ou la branche) visée, en place. Un chemin qui ne mène nulle part est une erreur. */
function removeAtPath(parameters: Record<string, unknown>, path: string | string[]): void {
  const segments = pathSegments(path);
  const shown = segments.join(' → ');
  let cursor: unknown = parameters;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) cursor = cursor[Number(segment)];
    else if (isPlainObject(cursor)) cursor = cursor[segment];
    else cursor = undefined;
    if (cursor === undefined) throw new WorkflowEditError(`Paramètre introuvable : ${shown}`);
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
      throw new WorkflowEditError(`Paramètre introuvable : ${shown}`);
    }
    cursor.splice(index, 1);
    return;
  }
  if (!isPlainObject(cursor) || !(last in cursor)) {
    throw new WorkflowEditError(`Paramètre introuvable : ${shown}`);
  }
  delete cursor[last];

  // `…columns.value.<colonne>` : le mapping ET le schéma, sinon le refresh de n8n
  // ramène la colonne qu'on vient d'enlever.
  if (segments.length >= 2 && segments[segments.length - 2] === 'value') {
    let parent: unknown = parameters;
    for (const segment of segments.slice(0, -2)) {
      parent = Array.isArray(parent) ? parent[Number(segment)] : (parent as Record<string, unknown>)[segment];
    }
    markRemovedInSchema(parent, last);
  }
}

function applyOne(workflow: N8nWorkflow, operation: WorkflowEditOperation): N8nWorkflow {
  switch (operation.op) {
    case 'set-workflow-name': {
      if (!operation.name?.trim()) throw new WorkflowEditError('Nom de workflow vide');
      return { ...workflow, name: operation.name.trim() };
    }

    case 'rename-node': {
      findNode(workflow, operation.node);
      const newName = operation.newName?.trim();
      if (!newName) throw new WorkflowEditError('Nouveau nom de nœud vide');
      if (workflow.nodes.some((n) => n.name === newName)) {
        throw new WorkflowEditError(`Un nœud nommé « ${newName} » existe déjà`);
      }
      return safeRenameNodes(workflow, [{ oldName: operation.node, newName }]);
    }

    case 'set-node-parameters':
    case 'patch-node-parameters': {
      findNode(workflow, operation.node);
      if (!operation.parameters || typeof operation.parameters !== 'object') {
        throw new WorkflowEditError(`Paramètres invalides pour « ${operation.node} »`);
      }
      return {
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.name === operation.node
            ? {
                ...node,
                parameters:
                  operation.op === 'set-node-parameters'
                    ? { ...operation.parameters }
                    : (deepMerge(node.parameters ?? {}, operation.parameters) as Record<string, unknown>),
              }
            : node,
        ),
      };
    }

    case 'remove-node-parameter': {
      const target = findNode(workflow, operation.node);
      const parameters = clone(target.parameters ?? {});
      removeAtPath(parameters, operation.path);
      return {
        ...workflow,
        nodes: workflow.nodes.map((node) => (node.name === operation.node ? { ...node, parameters } : node)),
      };
    }

    case 'set-node-notes': {
      findNode(workflow, operation.node);
      return {
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.name === operation.node ? { ...node, notes: operation.notes, notesInFlow: false } : node,
        ),
      };
    }

    case 'set-node-disabled': {
      findNode(workflow, operation.node);
      return {
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.name === operation.node ? { ...node, disabled: operation.disabled } : node,
        ),
      };
    }

    case 'remove-node': {
      findNode(workflow, operation.node);
      const connections = clone(workflow.connections ?? {});
      unlinkNode(connections, operation.node);
      const pinData = workflow.pinData
        ? Object.fromEntries(Object.entries(workflow.pinData).filter(([key]) => key !== operation.node))
        : undefined;
      return {
        ...workflow,
        nodes: workflow.nodes.filter((node) => node.name !== operation.node),
        connections,
        ...(pinData ? { pinData } : {}),
      };
    }

    case 'add-node': {
      const spec = operation.node;
      if (!spec?.name?.trim() || !spec.type?.trim()) {
        throw new WorkflowEditError('Un nouveau nœud exige au moins un `name` et un `type`');
      }
      if (workflow.nodes.some((n) => n.name === spec.name)) {
        throw new WorkflowEditError(`Un nœud nommé « ${spec.name} » existe déjà`);
      }
      if (operation.after) findNode(workflow, operation.after);
      if (operation.before) findNode(workflow, operation.before);

      const node: N8nNode = {
        id: randomUUID(),
        name: spec.name,
        type: spec.type,
        typeVersion: spec.typeVersion ?? 1,
        position: spec.position ?? insertPosition(workflow, operation.after ?? operation.before),
        parameters: spec.parameters ?? {},
        ...(spec.credentials && Object.keys(spec.credentials).length > 0
          ? { credentials: spec.credentials }
          : {}),
        ...(spec.notes ? { notes: spec.notes, notesInFlow: false } : {}),
      };
      const connections = clone(workflow.connections ?? {});

      if (operation.after) {
        // Insertion dans la chaîne : `after` → nouveau nœud → anciennes cibles de `after`.
        const successors = targetsOf(connections, operation.after).map((t) => ({ ...t }));
        const byType = (connections[operation.after] ??= {});
        byType[MAIN] ??= [];
        byType[MAIN][0] = [{ node: node.name, type: MAIN, index: 0 }];
        if (successors.length > 0) connections[node.name] = { [MAIN]: [successors] };
      } else if (operation.before) {
        // Insertion dans la chaîne : prédécesseurs de `before` → nouveau nœud → `before`.
        for (const byType of Object.values(connections)) {
          for (const outputs of Object.values(byType)) {
            for (let i = 0; i < outputs.length; i += 1) {
              outputs[i] = (outputs[i] ?? []).map((t) =>
                t.node === operation.before ? { ...t, node: node.name } : t,
              );
            }
          }
        }
        connections[node.name] = { [MAIN]: [[{ node: operation.before, type: MAIN, index: 0 }]] };
      }

      return { ...workflow, nodes: [...workflow.nodes, node], connections };
    }

    case 'connect': {
      findNode(workflow, operation.from);
      findNode(workflow, operation.to);
      const connections = clone(workflow.connections ?? {});
      addConnection(
        connections,
        operation.from,
        operation.to,
        operation.fromOutput ?? 0,
        operation.toInput ?? 0,
      );
      return { ...workflow, connections };
    }

    case 'disconnect': {
      findNode(workflow, operation.from);
      findNode(workflow, operation.to);
      const connections = clone(workflow.connections ?? {});
      removeConnection(connections, operation.from, operation.to);
      return { ...workflow, connections };
    }

    default: {
      const unknown = operation as { op?: string };
      throw new WorkflowEditError(`Opération inconnue : ${unknown.op ?? '(sans op)'}`);
    }
  }
}

/** Doublons de noms après application (toujours bloquants : n8n les refuse). */
function assertNoDuplicateNames(workflow: N8nWorkflow): void {
  const names = workflow.nodes.map((node) => node.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new WorkflowEditError(`Noms de nœuds en double : ${[...new Set(duplicates)].join(', ')}`);
  }
}

/**
 * Nœuds cités par les connexions mais absents du graphe, avec le côté de l'arête
 * où ils apparaissent (pour le message).
 */
function missingConnectionNodes(workflow: N8nWorkflow): Map<string, 'depuis' | 'vers'> {
  const known = new Set(workflow.nodes.map((node) => node.name));
  const missing = new Map<string, 'depuis' | 'vers'>();
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    if (!known.has(from) && !missing.has(from)) missing.set(from, 'depuis');
    for (const outputs of Object.values(byType)) {
      for (const targets of outputs) {
        for (const target of targets ?? []) {
          if (!known.has(target.node) && !missing.has(target.node)) missing.set(target.node, 'vers');
        }
      }
    }
  }
  return missing;
}

/**
 * Retire les arêtes citant un nœud absent, et retourne les noms concernés.
 * Une sortie vidée est conservée telle quelle : supprimer l'indice décalerait
 * les suivants, et sur un If la branche « false » deviendrait la branche « true ».
 */
function pruneDanglingConnections(workflow: N8nWorkflow): string[] {
  const known = new Set(workflow.nodes.map((node) => node.name));
  const pruned = new Set<string>();
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    if (!known.has(from)) {
      pruned.add(from);
      delete workflow.connections[from];
      continue;
    }
    for (const outputs of Object.values(byType)) {
      for (let i = 0; i < outputs.length; i += 1) {
        const targets = outputs[i] ?? [];
        const kept = targets.filter((target) => known.has(target.node));
        if (kept.length === targets.length) continue;
        for (const target of targets) if (!known.has(target.node)) pruned.add(target.node);
        outputs[i] = kept;
      }
    }
  }
  return [...pruned];
}

/** Alertes non bloquantes, affichées dans la revue de diff. */
function collectWarnings(before: N8nWorkflow, after: N8nWorkflow): string[] {
  const warnings: string[] = [];
  if (hasTrigger(before) && !hasTrigger(after)) {
    warnings.push("Le workflow n'a plus de nœud déclencheur : il ne pourra plus démarrer.");
  }
  const connected = new Set<string>();
  for (const [from, byType] of Object.entries(after.connections ?? {})) {
    connected.add(from);
    for (const outputs of Object.values(byType)) {
      for (const targets of outputs) for (const target of targets ?? []) connected.add(target.node);
    }
  }
  // Un nœud qui perd des centaines de paramètres n'a pas été retouché : son bloc a
  // été réécrit. Dit ici, l'assistant l'apprend par `check_workflow` avant de proposer.
  const beforeByName = new Map(before.nodes.map((node) => [node.name, node]));
  for (const node of after.nodes) {
    const previous = beforeByName.get(node.name);
    if (!previous) continue;
    const lost = lostLeafCount(previous.parameters ?? {}, node.parameters ?? {});
    if (lost >= MASS_LEAF_LOSS) {
      warnings.push(
        `« ${node.name} » perd ${lost} paramètres : si tu voulais n'en retirer qu'un, ` +
          'utilise `remove-node-parameter` plutôt que de renvoyer le bloc entier.',
      );
    }
  }

  const beforeNames = new Set(before.nodes.map((node) => node.name));
  const orphans = after.nodes
    .filter((node) => !connected.has(node.name) && !beforeNames.has(node.name))
    .map((node) => node.name);
  if (orphans.length > 0) {
    warnings.push(`Nœud(s) ajouté(s) sans connexion : ${orphans.join(', ')}.`);
  }
  return warnings;
}

/**
 * Applique une suite d'opérations sur un workflow n8n.
 * Rien n'est modifié en place : le workflow candidat est retourné, à confronter
 * à l'original via `diffWorkflows` avant toute écriture dans n8n.
 */
export function applyEditOperations(workflow: N8nWorkflow, operations: WorkflowEditOperation[]): EditResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new WorkflowEditError('Aucune opération à appliquer');
  }
  let current = clone(workflow);
  operations.forEach((operation, index) => {
    try {
      current = applyOne(current, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkflowEditError(`Opération ${index + 1} (${operation?.op ?? '?'}) : ${message}`);
    }
  });
  assertNoDuplicateNames(current);

  // Une connexion pendante déjà présente à l'entrée n'est pas l'affaire de cette
  // édition : la bloquer interdirait toute modification du workflow. On la nettoie
  // au passage — n8n n'exécute rien depuis ni vers un nœud absent — et le diff la montre.
  const inherited = missingConnectionNodes(workflow);
  const introduced = [...missingConnectionNodes(current)].filter(([name]) => !inherited.has(name));
  if (introduced.length > 0) {
    throw new WorkflowEditError(
      introduced.map(([name, side]) => `Connexion ${side} un nœud inexistant : ${name}`).join(' ; '),
    );
  }

  const warnings = collectWarnings(workflow, current);
  const pruned = pruneDanglingConnections(current);
  if (pruned.length > 0) {
    warnings.push(`Connexion(s) pendante(s) nettoyée(s) : ${pruned.join(', ')} (nœud absent du workflow).`);
  }
  return { workflow: current, warnings };
}
