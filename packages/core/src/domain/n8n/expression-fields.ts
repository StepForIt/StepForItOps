/**
 * Extraction des CHAMPS référencés dans les expressions n8n (et non plus seulement
 * des nœuds, cf. `expression-refs.ts`) :
 *   $('Node').item.json.salesFirstName   → { source: 'Node', path: 'salesFirstName' }
 *   $node["Node"].json.customer.email    → { source: 'Node', path: 'customer.email' }
 *   $json.total / $input.first().json.x  → source = nœud d'entrée (résolu par le graphe)
 *
 * Le chemin s'arrête au premier appel de fonction ou index de tableau
 * (`.lines[0].sku` → `lines`) : on ne compare que ce qui est comparable au
 * schéma observé en exécution.
 */

import { N8nWorkflow } from './workflow.types';
import { WorkflowGraph, isStickyNote } from './workflow-graph';
import { activeParameters } from './inert-params';

export interface FieldRef {
  /** Nœud dont on lit la sortie (déjà résolu pour `$json` / `$input`). */
  source: string;
  /** Chemin du champ après `.json` (ex. `customer.firstName`). */
  path: string;
  /** Nœud qui porte l'expression. */
  node: string;
  /** Chemin du paramètre où l'expression a été trouvée (ex. `$.parameters.text`). */
  at: string;
}

/** Référence dont la source n'est pas encore résolue (`$json` → nœud d'entrée). */
interface RawRef {
  /** null pour `$json` / `$input` : dépend du nœud courant. */
  source: string | null;
  path: string;
}

const SOURCE = String.raw`\$\(\s*["']([^"']+)["']\s*\)|\$node\s*\[\s*["']([^"']+)["']\s*\]|\$input\b|\$json\b`;
const CHAIN = String.raw`(?:\s*\.\s*[A-Za-z_$][\w$]*\s*(?:\(\s*[^()]*\s*\))?|\s*\[\s*\d+\s*\]|\s*\[\s*["'][^"']*["']\s*\])*`;
const REF_PATTERN = new RegExp(`(?:${SOURCE})(${CHAIN})`, 'g');
const TOKEN_PATTERN =
  /\.\s*([A-Za-z_$][\w$]*)\s*(\(\s*[^()]*\s*\))?|\[\s*(\d+)\s*\]|\[\s*["']([^"']*)["']\s*\]/g;

type Token =
  | { kind: 'prop'; name: string }
  | { kind: 'key'; name: string }
  | { kind: 'call'; name: string }
  | { kind: 'index' };

function tokenize(chain: string): Token[] {
  const tokens: Token[] = [];
  for (const match of chain.matchAll(TOKEN_PATTERN)) {
    const [, prop, call, index, key] = match;
    if (prop !== undefined) tokens.push(call ? { kind: 'call', name: prop } : { kind: 'prop', name: prop });
    else if (index !== undefined) tokens.push({ kind: 'index' });
    else if (key !== undefined) tokens.push({ kind: 'key', name: key });
  }
  return tokens;
}

/** Chemin lisible après `.json` : on s'arrête au premier appel / index. */
function pathAfterJson(tokens: Token[]): string {
  const segments: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'prop' || token.kind === 'key') segments.push(token.name);
    else break;
  }
  return segments.join('.');
}

export function extractFieldRefsFromString(value: string): RawRef[] {
  const refs: RawRef[] = [];
  for (const match of value.matchAll(REF_PATTERN)) {
    const [full, byCall, byBracket, chain] = match;
    const tokens = tokenize(chain ?? '');
    const isCurrentItem = full.startsWith('$json') || full.startsWith('$input');
    // `$json.x` attaque directement les champs ; partout ailleurs il faut passer par `.json`
    const jsonIndex = tokens.findIndex((t) => t.kind === 'prop' && t.name === 'json');
    const rest = full.startsWith('$json') ? tokens : jsonIndex === -1 ? [] : tokens.slice(jsonIndex + 1);
    const path = pathAfterJson(rest);
    if (!path) continue;
    refs.push({ source: isCurrentItem ? null : (byCall ?? byBracket), path });
  }
  return refs;
}

/** Parcourt récursivement les paramètres d'un nœud et collecte les refs par chemin. */
function refsInValue(value: unknown, path: string): Array<RawRef & { at: string }> {
  if (typeof value === 'string') {
    return extractFieldRefsFromString(value).map((ref) => ({ ...ref, at: path }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => refsInValue(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => refsInValue(child, `${path}.${key}`));
  }
  return [];
}

/**
 * Références de champs du workflow, dédupliquées. `$json` / `$input` ne sont
 * résolus qu'avec UN seul parent — sinon source ambiguë, référence ignorée
 * (mieux vaut rater un cas qu'un faux positif). Les branches inertes sont
 * écartées, cf. `inert-params.ts`.
 */
export function extractFieldRefs(workflow: N8nWorkflow): FieldRef[] {
  const graph = new WorkflowGraph(workflow);
  const seen = new Set<string>();
  const refs: FieldRef[] = [];

  for (const node of workflow.nodes) {
    if (isStickyNote(node) || node.disabled) continue;
    const parents = [...graph.parentsOf(node.name)];
    for (const raw of refsInValue(activeParameters(node), '$.parameters')) {
      const source = raw.source ?? (parents.length === 1 ? parents[0] : null);
      if (!source) continue;
      const key = `${node.name}|${source}|${raw.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ source, path: raw.path, node: node.name, at: raw.at });
    }
  }
  return refs;
}
