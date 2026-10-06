import { stableJson } from '../stable-json';
import { RenameSpec, safeRenameNodes } from './safe-rename';
import { N8nNode } from './workflow.types';

export type RenameEvidence = 'id' | 'parameter-ids' | 'fingerprint';

export interface NodeRename extends RenameSpec {
  /** Ce qui a permis de dire que c'est le même nœud, du plus sûr au moins sûr. */
  evidence: RenameEvidence;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les uuid que n8n pose DANS les paramètres (conditions d'un If, assignations d'un Set…). */
function parameterIds(node: N8nNode): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'id' && typeof inner === 'string' && UUID.test(inner)) ids.add(inner.toLowerCase());
        else walk(inner);
      }
    }
  };
  walk(node.parameters ?? {});
  return ids;
}

function fingerprint(node: N8nNode): string {
  return stableJson({
    type: node.type,
    typeVersion: node.typeVersion ?? null,
    parameters: node.parameters ?? {},
  });
}

/** Paires où chaque côté n'a QUE l'autre pour candidat : un doute laisse les deux nœuds au niveau suivant. */
function uniquePairs(
  removed: N8nNode[],
  added: N8nNode[],
  same: (before: N8nNode, after: N8nNode) => boolean,
): Array<[N8nNode, N8nNode]> {
  const pairs: Array<[N8nNode, N8nNode]> = [];
  for (const before of removed) {
    const candidates = added.filter((after) => same(before, after));
    if (candidates.length !== 1) continue;
    const reverse = removed.filter((other) => same(other, candidates[0]));
    if (reverse.length === 1) pairs.push([before, candidates[0]]);
  }
  return pairs;
}

/**
 * Apparie les nœuds disparus d'un côté et apparus de l'autre : un renommage n'est
 * pas une suppression suivie d'un ajout. Jamais par le nom, qui est justement ce qui
 * change. En cascade, du plus sûr au moins sûr :
 * 1. l'id n8n du nœud, stable au renommage — mais régénéré par un copier-coller ;
 * 2. les uuid posés dans ses paramètres (conditions, assignations), de même type ;
 * 3. l'empreinte type + version + paramètres, une fois les références aux nœuds déjà
 *    appariés réécrites : `$('StartLoop')` devenu `$('Start Prospect Loop')` est la
 *    conséquence d'un autre renommage, pas une modification. Rejouée jusqu'à ce
 *    qu'elle ne trouve plus rien, chaque paire pouvant en débloquer une autre.
 * Deux jumeaux (même empreinte) restent ajout + suppression : mieux vaut un diff
 * bavard qu'un renommage inventé.
 */
export function pairRenamedNodes(removed: readonly N8nNode[], added: readonly N8nNode[]): NodeRename[] {
  const renames: NodeRename[] = [];
  let left = [...removed];
  let right = [...added];
  const take = (pairs: Array<[N8nNode, N8nNode]>, evidence: RenameEvidence): void => {
    for (const [before, after] of pairs) {
      renames.push({ oldName: before.name, newName: after.name, evidence });
      left = left.filter((node) => node !== before);
      right = right.filter((node) => node !== after);
    }
  };

  take(
    uniquePairs(left, right, (before, after) => !!before.id && before.id === after.id),
    'id',
  );

  const ids = new Map([...left, ...right].map((node) => [node, parameterIds(node)]));
  take(
    uniquePairs(
      left,
      right,
      (before, after) =>
        before.type === after.type && [...(ids.get(before) ?? [])].some((id) => ids.get(after)?.has(id)),
    ),
    'parameter-ids',
  );

  for (;;) {
    // Les nœuds restants relus avec les noms déjà appariés : leurs références suivent.
    const aligned = safeRenameNodes({ name: '', nodes: left, connections: {} }, renames).nodes;
    const original = new Map(aligned.map((node, index) => [node, left[index]]));
    const prints = new Map([...aligned, ...right].map((node) => [node, fingerprint(node)]));
    const pairs = uniquePairs(aligned, right, (before, after) => prints.get(before) === prints.get(after));
    if (pairs.length === 0) break;
    take(
      pairs.map(([before, after]) => [original.get(before) as N8nNode, after]),
      'fingerprint',
    );
  }

  return renames;
}
