/**
 * Schéma RÉEL observé en sortie de chaque nœud, reconstitué depuis le JSON des
 * dernières exécutions n8n (`GET /executions?includeData=true`).
 *
 * Le format n'est pas contractuel : tout est défensif (un JSON inattendu produit
 * un échantillon vide, jamais une exception). Union sur plusieurs exécutions :
 * les branches non prises dans une exécution donnée sont couvertes par une autre.
 */

export interface NodeSamples {
  node: string;
  /** Nombre d'exécutions où ce nœud a produit au moins un item. */
  executions: number;
  /** Nombre d'items échantillonnés (toutes exécutions confondues). */
  items: number;
  /** Chemins de champs observés, aplatis (ex. `customer.firstName`). */
  fields: string[];
}

export interface SampleOptions {
  /** Items lus par nœud et par exécution. */
  maxItemsPerNode?: number;
  /** Profondeur d'aplatissement des objets imbriqués. */
  maxDepth?: number;
  /** Garde-fou : nombre max de chemins retenus par nœud. */
  maxFieldsPerNode?: number;
}

const DEFAULTS = { maxItemsPerNode: 10, maxDepth: 3, maxFieldsPerNode: 300 };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `data` peut arriver en objet ou en chaîne JSON selon la version de n8n. */
function parseData(data: unknown): Record<string, unknown> | undefined {
  if (typeof data === 'string') {
    try {
      return asRecord(JSON.parse(data));
    } catch {
      return undefined;
    }
  }
  return asRecord(data);
}

/**
 * Aplatit les clés d'un item. Les tableaux ne sont pas parcourus : seul leur
 * chemin est retenu (cohérent avec l'extraction de refs, qui s'arrête sur `[0]`).
 */
function flattenKeys(
  value: Record<string, unknown>,
  prefix: string,
  depth: number,
  out: Set<string>,
  options: Required<SampleOptions>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (out.size >= options.maxFieldsPerNode) return;
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    const nested = asRecord(child);
    if (nested && depth < options.maxDepth) flattenKeys(nested, path, depth + 1, out, options);
  }
}

/** Items produits par un nœud sur une exécution : runData[node][run].data.main[output][item].json */
function itemsOfRun(run: unknown): Array<Record<string, unknown>> {
  const data = asRecord(asRecord(run)?.data);
  const main = data?.main;
  if (!Array.isArray(main)) return [];
  const items: Array<Record<string, unknown>> = [];
  for (const output of main) {
    if (!Array.isArray(output)) continue;
    for (const item of output) {
      const json = asRecord(asRecord(item)?.json);
      if (json) items.push(json);
    }
  }
  return items;
}

/** `resultData.runData` d'une exécution : `data` arrive en objet ou en chaîne JSON selon la version. */
export function readRunData(execution: { data?: unknown }): Record<string, unknown> | undefined {
  return asRecord(asRecord(parseData(execution.data)?.resultData)?.runData);
}

/** Agrège les échantillons d'un lot d'exécutions (les plus récentes de préférence). */
export function collectExecutionSamples(
  executions: Array<{ data?: unknown }>,
  options: SampleOptions = {},
): NodeSamples[] {
  const settings = { ...DEFAULTS, ...options };
  const perNode = new Map<string, { executions: number; items: number; fields: Set<string> }>();

  for (const execution of executions) {
    const runData = readRunData(execution);
    if (!runData) continue;

    for (const [node, runs] of Object.entries(runData)) {
      if (!Array.isArray(runs)) continue;
      const items = runs.flatMap(itemsOfRun).slice(0, settings.maxItemsPerNode);
      if (items.length === 0) continue;

      if (!perNode.has(node)) perNode.set(node, { executions: 0, items: 0, fields: new Set() });
      const entry = perNode.get(node)!;
      entry.executions += 1;
      entry.items += items.length;
      for (const item of items) flattenKeys(item, '', 1, entry.fields, settings);
    }
  }

  return [...perNode.entries()]
    .map(([node, entry]) => ({
      node,
      executions: entry.executions,
      items: entry.items,
      fields: [...entry.fields].sort(),
    }))
    .sort((a, b) => a.node.localeCompare(b.node));
}

/**
 * Items RÉELS produits par des nœuds donnés, les plus récents d'abord — de quoi
 * pré-remplir un banc d'essai avec de la vraie donnée plutôt qu'un formulaire
 * vide. `collectExecutionSamples` n'en garde que les chemins de champs ; ici on
 * garde les valeurs, donc l'appelant reste responsable de ce qu'il en affiche.
 */
export function collectNodeItems(
  executions: Array<{ data?: unknown }>,
  nodes: string[],
  maxItems = 3,
): Record<string, Array<Record<string, unknown>>> {
  const wanted = new Set(nodes);
  const out: Record<string, Array<Record<string, unknown>>> = {};

  for (const execution of executions) {
    const runData = readRunData(execution);
    if (!runData) continue;
    for (const [node, runs] of Object.entries(runData)) {
      if (!wanted.has(node) || !Array.isArray(runs)) continue;
      const already = out[node]?.length ?? 0;
      if (already >= maxItems) continue;
      const items = runs.flatMap(itemsOfRun);
      if (items.length === 0) continue;
      out[node] = [...(out[node] ?? []), ...items].slice(0, maxItems);
    }
  }
  return out;
}
