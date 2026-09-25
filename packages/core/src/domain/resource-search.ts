/**
 * Recherche d'une ressource externe dans le sélecteur.
 *
 * Ce qu'on tape n'est presque jamais ce qui est écrit dans le JSON n8n : on cherche
 * « noco » (le système), « CRM » (la base), « Prospect » (la table), parfois `tblX0eb`
 * (l'id collé depuis une URL). Une ressource est donc réduite à un sac de termes —
 * système, contenant, élément, hôte, urls appelées, clé technique, alias — et la
 * saisie est confrontée à ce sac, mot par mot.
 */

/** Ce qui, d'une ressource, peut être reconnu par un humain qui la cherche. */
export interface ResourceSearchInput {
  key: string;
  /** Nom du système, dans les deux formes : `nocodb` et « NocoDB ». */
  provider: string;
  providerLabel?: string;
  containerName?: string;
  itemName?: string;
  /** Nom posé à la main, qui prime sur tout le reste à l'affichage. */
  alias?: string;
  /** URLs appelées, pour les APIs externes. */
  urls?: string[];
}

/** Tous les mots sous lesquels cette ressource peut être cherchée, en minuscules. */
export function resourceSearchTerms(resource: ResourceSearchInput): string[] {
  const terms = [
    resource.key,
    resource.provider,
    resource.providerLabel,
    resource.containerName,
    resource.itemName,
    resource.alias,
    ...(resource.urls ?? []),
  ];
  return terms
    .filter((term): term is string => Boolean(term && term.trim()))
    .map((term) => term.toLowerCase());
}

/**
 * Vrai si la saisie décrit cette ressource. Chaque mot saisi doit se retrouver dans
 * au moins un terme : « crm prospect » ne ramène que la table Prospect de la base CRM,
 * alors que « crm » seul ramène toutes les tables de la base. Une saisie vide passe.
 */
export function matchesResourceQuery(terms: string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => terms.some((term) => term.includes(word)));
}
