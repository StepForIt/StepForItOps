/**
 * Appariement des entrées de la barre de recherche globale.
 *
 * Insensible aux accents : « coûts » se tape « couts », et les noms de workflows
 * mélangent les deux graphies sans que l'utilisateur ait à choisir.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Tous les mots de la requête doivent se retrouver dans l'un des champs, dans
 * n'importe quel ordre : « crm prod » trouve « FORM -> CRM - PROD ».
 */
export function matchesQuery(query: string, ...fields: Array<string | undefined | null>): boolean {
  const haystack = normalize(fields.filter(Boolean).join(' '));
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}
