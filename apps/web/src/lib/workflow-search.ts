/**
 * Règles communes aux recherches de workflows (barre ⌘K et liste) : elles doivent
 * se déclencher au même moment et ne pas synchroniser deux fois le même terme.
 */

/**
 * En dessous, une recherche ne discrimine rien : « ai » renverrait la moitié du
 * parc, pour un résultat que personne ne lit et une requête à chaque lettre.
 */
export const MIN_SEARCH_CHARS = 3;

/** Clé d'une recherche déjà rattrapée par une synchro : une par (instance, terme). */
function searchSyncKey(search: string, scope: string | null): string {
  return `${scope ?? 'all'}|${search.trim().toLowerCase()}`;
}

/**
 * Cette recherche mérite-t-elle une synchro ? Non si elle prolonge un terme déjà
 * revenu bredouille : « factu » ne peut rien trouver là où « fact » n'a rien
 * trouvé, et sans cette règle la frappe tenterait une synchro par lettre. Le
 * terme est marqué au passage — l'appel n'est vrai qu'une fois.
 *
 * `attempted` vit dans le composant : la barre rouverte ou la page rechargée
 * retentent, ce qui est voulu (on y revient justement parce qu'on cherche
 * quelque chose de nouveau). Le vrai frein est le délai de garde de l'API.
 */
export function claimSearchSync(search: string, scope: string | null, attempted: Set<string>): boolean {
  const term = search.trim();
  if (term.length < MIN_SEARCH_CHARS) return false;
  const key = searchSyncKey(term, scope);
  if ([...attempted].some((previous) => key.startsWith(previous))) return false;
  attempted.add(key);
  return true;
}
