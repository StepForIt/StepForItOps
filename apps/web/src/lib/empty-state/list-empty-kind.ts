/**
 * Pourquoi une liste est vide, dans l'ordre où la réponse change le geste à proposer :
 *
 * - `no-instance` : la page lit le parc et aucune instance n'est déclarée — l'unique
 *   geste utile est d'en ajouter une (elles sont rangées dans Paramètres, une
 *   installation neuve ne savait pas par où commencer) ;
 * - `no-search-match` : la recherche ne trouve rien — jamais « ajoute une instance »
 *   quand il y en a déjà une ;
 * - `no-filter-match` : les filtres écartent tout, on propose de les retirer ;
 * - `idle` : rien ne filtre, il ne s'est simplement encore rien passé — c'est la page
 *   qui sait quoi dire et quoi proposer.
 *
 * `instanceCount` vaut `null` sur une page qui ne dépend pas du parc (clients, canaux
 * d'alerte…) : la question des instances ne s'y pose pas.
 */
export type ListEmptyKind = 'no-instance' | 'no-search-match' | 'no-filter-match' | 'idle';

export function listEmptyKind({
  instanceCount,
  search,
  filterCount = 0,
}: {
  instanceCount: number | null;
  search?: string;
  filterCount?: number;
}): ListEmptyKind {
  if (instanceCount === 0) return 'no-instance';
  if (search?.trim()) return 'no-search-match';
  if (filterCount > 0) return 'no-filter-match';
  return 'idle';
}
