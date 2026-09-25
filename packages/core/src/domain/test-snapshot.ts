/**
 * Cas de test enregistrés depuis une exécution réelle : l'entrée du webhook
 * devient le payload à rejouer, la sortie du dernier nœud devient le snapshot
 * attendu. La comparaison normalise les parties variables (ids, dates, urls) —
 * même philosophie que error-signature : deux sorties « de la même forme »
 * doivent matcher, sinon chaque rejeu serait un faux échec.
 */

type Json = Record<string, unknown>;

/** Parties variables d'une chaîne, remplacées avant comparaison. Ordre significatif. */
const STRING_RULES: Array<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/https?:\/\/\S+/gi, '<url>'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>'],
  [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, '<date>'],
  // Ids Airtable : préfixe de type + 14 caractères. La règle générique ci-dessous
  // exige un chiffre pour ne pas neutraliser des mots ; un id tiré au sort peut
  // n'en avoir aucun (recdywSDhUCmCJrQY), et le test rougissait alors pour de bon.
  [/\b(?:rec|app|tbl|fld|viw|usr|att|sel|pbd|shr)[A-Za-z0-9]{14}\b/g, '<id>'],
  [/\b(?=[A-Za-z0-9_]{12,}\b)(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]+\b/g, '<id>'],
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
];

function normalizeString(text: string): string {
  let out = text;
  for (const [pattern, placeholder] of STRING_RULES) out = out.replace(pattern, placeholder);
  return out;
}

/**
 * Copie normalisée d'une valeur JSON : les chaînes perdent leurs parties
 * variables, les nombres restent tels quels (un montant EST de la donnée).
 */
export function normalizeSnapshot(value: unknown): unknown {
  if (typeof value === 'string') return normalizeString(value);
  if (Array.isArray(value)) return value.map(normalizeSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Json).map(([key, child]) => [key, normalizeSnapshot(child)]),
    );
  }
  return value;
}

/** Nature d'un écart : ce qui décide du message et de la gravité affichée. */
export type SnapshotDiffKind =
  /** Une valeur a changé (le cas courant : la donnée n'est plus la même). */
  | 'value'
  /** Les deux côtés n'ont pas le même type (texte "12" contre nombre 12). */
  | 'type'
  /** Le champ était dans la référence, il a disparu de la sortie du rejeu. */
  | 'missing'
  /** Le champ n'existait pas dans la référence, le rejeu en produit un. */
  | 'extra'
  /** Le nombre d'éléments de la liste diffère. */
  | 'count'
  /**
   * Une partie variable (id, date, url…) n'a été reconnue que d'un côté : la
   * comparaison compare alors un jeton à une valeur brute. C'est un artefact du
   * normaliseur, pas une différence de donnée — dit tel quel plutôt que
   * maquillé en écart métier.
   */
  | 'normalization';

export interface SnapshotDiff {
  /** Chemin machine dans la sortie : `$[0].items[2].status`. */
  path: string;
  /** Dernier segment, celui qu'on nomme dans la phrase : `status`. */
  field: string;
  kind: SnapshotDiffKind;
  /** Valeurs affichées (déjà tronquées), absentes pour un écart de taille. */
  expected?: string;
  actual?: string;
  /** Phrase prête à lire, qui dit ce qui a changé et dans quel sens. */
  message: string;
}

export interface SnapshotComparison {
  match: boolean;
  diffs: SnapshotDiff[];
  /** Une ligne de synthèse : combien d'écarts, et de quelles natures. */
  summary: string;
}

const MAX_DIFFS = 20;

/** Jetons posés par la normalisation : une partie variable, jamais une donnée. */
const PLACEHOLDERS = new Set(['<uuid>', '<url>', '<email>', '<date>', '<id>', '<hex>']);

/** Compare deux valeurs APRÈS normalisation, en listant où ça diverge. */
export function compareSnapshots(expected: unknown, actual: unknown): SnapshotComparison {
  const diffs: SnapshotDiff[] = [];
  walk(normalizeSnapshot(expected), normalizeSnapshot(actual), '$', diffs);
  return { match: diffs.length === 0, diffs, summary: summarize(diffs) };
}

const KIND_NOUNS: Record<SnapshotDiffKind, [string, string]> = {
  value: ['valeur différente', 'valeurs différentes'],
  type: ['type différent', 'types différents'],
  missing: ['champ disparu', 'champs disparus'],
  extra: ['champ en plus', 'champs en plus'],
  count: ['liste de taille différente', 'listes de taille différente'],
  normalization: ['artefact de comparaison', 'artefacts de comparaison'],
};

function summarize(diffs: SnapshotDiff[]): string {
  if (diffs.length === 0) return 'Sortie conforme à la référence.';
  const counts = new Map<SnapshotDiffKind, number>();
  for (const diff of diffs) counts.set(diff.kind, (counts.get(diff.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) => {
    const [one, many] = KIND_NOUNS[kind];
    return `${count} ${count > 1 ? many : one}`;
  });
  const head = `${diffs.length} écart${diffs.length > 1 ? 's' : ''} avec la référence`;
  return `${head} : ${parts.join(', ')}.`;
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? 'undefined' : text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * Nom lisible du champ : le dernier segment NOMMÉ du chemin, suivi de son rang
 * quand il s'agit d'un élément de liste — « salesName (élément 1) » situe, là
 * où « élément 1 » tout seul laisse chercher.
 */
function fieldOf(path: string): string {
  const trailing = path.match(/(?:\[\d+\])+$/)?.[0] ?? '';
  const named = path.slice(0, path.length - trailing.length).match(/\.([^.[\]]+)$/)?.[1];
  const ranks = [...trailing.matchAll(/\[(\d+)\]/g)].map((m) => `élément ${Number(m[1]) + 1}`);
  if (named) return ranks.length ? `${named} (${ranks.join(', ')})` : named;
  return ranks.length ? ranks[ranks.length - 1] : path;
}

/** Une seule des deux valeurs porte un jeton de normalisation. */
function isNormalizationArtifact(expected: unknown, actual: unknown): boolean {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const tagged = (text: string) => [...PLACEHOLDERS].some((token) => text.includes(token));
  return tagged(expected) !== tagged(actual);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'liste';
  switch (typeof value) {
    case 'string':
      return 'texte';
    case 'number':
      return 'nombre';
    case 'boolean':
      return 'booléen';
    case 'object':
      return 'objet';
    default:
      return 'rien';
  }
}

function push(diffs: SnapshotDiff[], diff: Omit<SnapshotDiff, 'field'>): void {
  diffs.push({ ...diff, field: fieldOf(diff.path) });
}

function walk(expected: unknown, actual: unknown, path: string, diffs: SnapshotDiff[]): void {
  if (diffs.length >= MAX_DIFFS) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      push(diffs, {
        path,
        kind: 'count',
        message: `${fieldOf(path)} : le rejeu a produit ${actual.length} élément(s) là où la référence en avait ${expected.length}.`,
      });
      return;
    }
    expected.forEach((item, index) => walk(item, actual[index], `${path}[${index}]`, diffs));
    return;
  }
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected as Json), ...Object.keys(actual as Json)]);
    for (const key of keys) {
      walk((expected as Json)[key], (actual as Json)[key], `${path}.${key}`, diffs);
    }
    return;
  }
  if (expected === actual) return;

  const field = fieldOf(path);
  const before = show(expected);
  const after = show(actual);

  if (actual === undefined) {
    push(diffs, {
      path,
      kind: 'missing',
      expected: before,
      message: `${field} : le champ n'est plus produit par le rejeu (la référence portait ${before}).`,
    });
    return;
  }
  if (expected === undefined) {
    push(diffs, {
      path,
      kind: 'extra',
      actual: after,
      message: `${field} : le rejeu produit un champ que la référence n'avait pas (${after}).`,
    });
    return;
  }
  if (isNormalizationArtifact(expected, actual)) {
    push(diffs, {
      path,
      kind: 'normalization',
      expected: before,
      actual: after,
      message: `${field} : partie variable (id, date, url…) reconnue d'un seul côté — ${before} face à ${after}. C'est la comparaison qui bute, pas la donnée : réenregistre le cas de test si l'écart persiste.`,
    });
    return;
  }
  if (typeName(expected) !== typeName(actual)) {
    push(diffs, {
      path,
      kind: 'type',
      expected: before,
      actual: after,
      message: `${field} : ${typeName(actual)} ${after} là où la référence avait ${typeName(expected)} ${before}.`,
    });
    return;
  }
  push(diffs, {
    path,
    kind: 'value',
    expected: before,
    actual: after,
    message: `${field} : le rejeu a produit ${after}, la référence disait ${before}.`,
  });
}

export interface ExecutionSnapshot {
  /** Dernier nœud exécuté (celui dont la sortie fait foi), null si illisible. */
  lastNode: string | null;
  /** Items produits par ce nœud (json seulement). */
  items: Json[];
  /** Corps reçu par le nœud webhook (le payload à rejouer), null si pas de webhook. */
  webhookPayload: unknown;
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function itemsOfNode(runData: Json, node: string): Json[] {
  const runs = runData[node];
  if (!Array.isArray(runs)) return [];
  const items: Json[] = [];
  for (const run of runs) {
    const main = asRecord(asRecord(run)?.data)?.main;
    if (!Array.isArray(main)) continue;
    for (const output of main) {
      if (!Array.isArray(output)) continue;
      for (const item of output) {
        const json = asRecord(asRecord(item)?.json);
        if (json) items.push(json);
      }
    }
  }
  return items;
}

/**
 * Lit le snapshot d'une exécution n8n (`GET /executions/:id?includeData=true`) :
 * entrée du webhook + sortie du dernier nœud exécuté (`lastNodeExecuted`).
 */
export function extractExecutionSnapshot(executionData: unknown, webhookNode?: string): ExecutionSnapshot {
  const data = typeof executionData === 'string' ? safeParse(executionData) : executionData;
  const resultData = asRecord(asRecord(data)?.resultData);
  const runData = asRecord(resultData?.runData);
  const lastNode = typeof resultData?.lastNodeExecuted === 'string' ? resultData.lastNodeExecuted : null;

  let webhookPayload: unknown = null;
  if (runData && webhookNode) {
    const first = itemsOfNode(runData, webhookNode)[0];
    // Le nœud Webhook sort { headers, params, query, body } : le body est ce qu'on rejoue.
    webhookPayload = first ? (first.body ?? first) : null;
  }

  return {
    lastNode,
    items: runData && lastNode ? itemsOfNode(runData, lastNode) : [],
    webhookPayload,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
