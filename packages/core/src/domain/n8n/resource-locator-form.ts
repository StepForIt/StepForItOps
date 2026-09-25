/**
 * Forme d'un resourceLocator n8n (`{ __rl: true, mode, value, cachedResultName… }`).
 *
 * Une même ressource s'écrit de plusieurs façons que n8n exécute à l'identique :
 * choisie dans la liste (`mode: list`, nom et url affichés à côté) ou tapée
 * (`mode: id`), en valeur fixe ou en expression sans gabarit (`=appX` vaut `appX`).
 * Comparer ces écritures telles quelles fait passer un changement de forme pour
 * une modification — et une promotion qui écrase l'une par l'autre ne fait
 * qu'effacer le nom lisible de l'éditeur.
 */
import { N8nNode, N8nWorkflow } from './workflow.types';

type Locator = Record<string, unknown> & { __rl: true };

/** Modes qui désignent la ressource par son id : ils ne diffèrent que dans l'éditeur. */
const ID_MODES = new Set(['list', 'id']);

function isLocator(value: unknown): value is Locator {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['__rl'] === true
  );
}

/** `=appX` sans `{{ }}` est une expression qui vaut le texte qui suit le `=`. */
function literalValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('=') || value.includes('{{')) return value;
  return value.slice(1);
}

/** Ce que le sélecteur VISE, sans ce qui ne sert qu'à l'affichage. */
function canonicalLocator(locator: Locator): Locator {
  const { cachedResultName: _name, cachedResultUrl: _url, ...rest } = locator;
  const mode = typeof rest['mode'] === 'string' && ID_MODES.has(rest['mode']) ? 'id' : rest['mode'];
  return { ...rest, mode, value: literalValue(rest['value']) };
}

function sameTarget(a: Locator, b: Locator): boolean {
  const left = canonicalLocator(a);
  const right = canonicalLocator(b);
  return left['mode'] === right['mode'] && left['value'] === right['value'];
}

function canonicalize(value: unknown): unknown {
  if (isLocator(value)) return canonicalLocator(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, canonicalize(inner)]),
    );
  }
  return value;
}

/** Le nœud avec ses sélecteurs ramenés à ce qu'ils visent : deux écritures de la même ressource se confondent. */
export function canonicalLocatorNode(node: N8nNode): N8nNode {
  return { ...node, parameters: canonicalize(node.parameters ?? {}) as Record<string, unknown> };
}

/** Même travail sur une valeur quelconque (paramètres, sous-arbre). */
export function canonicalLocators<T>(value: T): T {
  return canonicalize(value) as T;
}

/** Descente parallèle : au même chemin, un sélecteur qui vise la même ressource reprend la forme de la cible. */
function adopt(candidate: unknown, target: unknown, count: { n: number }): unknown {
  if (isLocator(candidate)) {
    if (isLocator(target) && sameTarget(candidate, target)) {
      if (JSON.stringify(candidate) !== JSON.stringify(target)) count.n += 1;
      return target;
    }
    return candidate;
  }
  if (Array.isArray(candidate)) {
    return candidate.map((item, index) =>
      adopt(item, Array.isArray(target) ? target[index] : undefined, count),
    );
  }
  if (candidate && typeof candidate === 'object') {
    const other =
      target && typeof target === 'object' && !Array.isArray(target)
        ? (target as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>).map(([key, inner]) => [
        key,
        adopt(inner, other[key], count),
      ]),
    );
  }
  return candidate;
}

/**
 * Chaque sélecteur du candidat qui vise la même ressource que celui de la cible,
 * au même endroit du même nœud, reprend l'écriture de la cible — mode et nom
 * affiché compris. Promouvoir ne doit changer que ce qui est visé : écraser un
 * choix de liste par un id tapé retire le nom lisible de l'éditeur de la cible
 * sans que rien n'ait changé à l'exécution.
 */
export function adoptTargetLocators(
  candidate: N8nWorkflow,
  target: N8nWorkflow | undefined,
): { workflow: N8nWorkflow; adopted: number } {
  if (!target?.nodes?.length) return { workflow: candidate, adopted: 0 };
  const targetNodes = new Map(target.nodes.map((node) => [node.name, node]));
  const count = { n: 0 };
  const nodes = (candidate.nodes ?? []).map((node) => {
    const counterpart = targetNodes.get(node.name);
    if (!counterpart || counterpart.type !== node.type) return node;
    return {
      ...node,
      parameters: adopt(node.parameters ?? {}, counterpart.parameters ?? {}, count) as Record<
        string,
        unknown
      >,
    };
  });
  return { workflow: { ...candidate, nodes }, adopted: count.n };
}
