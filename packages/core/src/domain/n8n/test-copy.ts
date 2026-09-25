/**
 * Copie bouchonnée d'un workflow : l'exemplaire jetable posé dans n8n pour
 * essayer un workflow sans que rien n'en sorte pour de vrai (nœuds épinglés,
 * appels de sous-workflow reroutés).
 *
 * Le nom porte `[TEST]` pour se reconnaître dans n8n, mais l'identité de la
 * copie tient au TAG et à lui seul : « [TEST] Facturation » est aussi un nom
 * qu'un humain pose à la main sur un vrai workflow, et l'exclure du miroir sur
 * son seul nom ferait disparaître des listes un workflow que personne n'a
 * demandé à cacher. Le tag, lui, n'est posé que par la plateforme — et il
 * survit à un renommage, là où le préfixe se perd au premier coup d'éditeur.
 */

/** Préfixe du nom de la copie — lisibilité dans n8n, jamais un critère d'exclusion. */
export const TEST_COPY_PREFIX = '[TEST]';
/** Tag posé sur la copie : c'est lui qui la sort des listes et des analyses. */
export const TEST_COPY_TAG = 'n8n-ops:copie-test';

/** "Facturation" → "[TEST] Facturation". */
export function testCopyName(workflowName: string): string {
  return `${TEST_COPY_PREFIX} ${workflowName}`;
}

/** Une copie de test se reconnaît à son tag, jamais à son nom (cf. en-tête). */
export function isTestCopy(tags: string[]): boolean {
  return tags.includes(TEST_COPY_TAG);
}
