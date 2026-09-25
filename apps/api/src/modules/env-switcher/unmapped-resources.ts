import { N8nWorkflow, ResourceRef, extractResourceRefs } from '@nwm/core';
import { MappingValues, allKnownIds } from './mapping-replacements';

/** Providers qu'un ResourceMapping sait basculer (les http/execute-workflow, non). */
const MAPPABLE_PROVIDERS = new Set(['airtable', 'google-sheets', 'notion', 'nocodb', 'postgres']);

export interface UnmappedResource {
  key: string;
  provider: string;
  /** Nom lisible si n8n le connaît (cachedResultName), sinon la clé parle d'elle-même. */
  label?: string;
  nodes: string[];
}

/** Ids bruts d'une ref : le détail + les segments de la clé canonique (`airtable:app/tbl`). */
function idsOf(ref: ResourceRef): string[] {
  const fromKey = ref.key.slice(ref.key.indexOf(':') + 1).split('/');
  const fromDetail = Object.values(ref.detail ?? {});
  return [...fromKey, ...fromDetail].filter((id) => id.length >= 4);
}

/**
 * Ressources basculables du workflow qu'AUCUN mapping ne connaît : une bascule
 * d'env les laisserait telles quelles, en silence. C'est la liste que le modal
 * affiche pour dire « déclare d'abord ces mappings » au lieu de basculer à vide.
 */
export function findUnmappedResources(workflow: N8nWorkflow, mappings: MappingValues[]): UnmappedResource[] {
  const known = new Set(mappings.flatMap((values) => allKnownIds(values)));
  const byKey = new Map<string, UnmappedResource>();

  for (const ref of extractResourceRefs(workflow)) {
    if (!MAPPABLE_PROVIDERS.has(ref.provider)) continue;
    // Un seul id connu suffit : le mapping couvre la ressource (même partiellement).
    if (idsOf(ref).some((id) => known.has(id))) continue;
    const existing = byKey.get(ref.key);
    if (existing) {
      if (!existing.nodes.includes(ref.nodeName)) existing.nodes.push(ref.nodeName);
    } else {
      byKey.set(ref.key, {
        key: ref.key,
        provider: ref.provider,
        label: ref.label,
        nodes: [ref.nodeName],
      });
    }
  }
  return [...byKey.values()];
}
