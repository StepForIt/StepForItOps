/** Valeurs des filtres de la page, partagées par la vue plate et la vue groupée. */
export interface Filters {
  q?: string;
  instanceId?: string;
  env?: string;
  active?: string;
  /** Membres d'un groupe métier seulement. */
  groupId?: string;
  /** `default` = réglage général de la plateforme (page Modules). */
  archived: string;
  /** Écart avec la prod : un id d'env (à déployer), `diverged` ou `behind`. */
  divergence?: string;
}

export const DEFAULT_FILTERS: Filters = { archived: 'default' };

/**
 * Nombre de filtres posés, pour le badge du bouton « Filtres » sur mobile : les
 * filtres y vivent dans un tiroir fermé, et une liste raccourcie sans raison
 * visible passerait pour une liste vide. La recherche n'est pas comptée, elle
 * reste affichée au-dessus de la liste ; l'instance non plus quand le scope
 * global la masque (elle ne filtre alors rien).
 */
export function activeFilterCount(filters: Filters, { scoped }: { scoped: boolean }): number {
  const posed = [
    scoped ? undefined : filters.instanceId,
    filters.env,
    filters.divergence,
    filters.groupId,
    filters.active,
    filters.archived === DEFAULT_FILTERS.archived ? undefined : filters.archived,
  ];
  return posed.filter(Boolean).length;
}
