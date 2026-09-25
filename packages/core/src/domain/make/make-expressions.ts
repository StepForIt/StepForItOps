/**
 * Les expressions Make : `{{2.email}}`, `{{6.__IMTLENGTH__}}`,
 * `{{split(1.\`1\`; space)}}`.
 *
 * On ne référence pas un module par son NOM comme chez n8n, mais par son ID
 * entier. Deux conséquences : renommer un module ne casse rien (rien à réécrire
 * autour d'un nom, cf. `module-naming.ts`), et une référence fautive ne se voit
 * qu'en confrontant l'id à ce qui existe et à ce qui aura tourné.
 */

/**
 * Les ids référencés dans un lot de chaînes.
 *
 * Volontairement large sur ce qui suit l'id — `.field`, `.\`0\``, `[]`,
 * `.__IMTLENGTH__` — parce que ce qui nous intéresse est l'id, et que rater une
 * forme reviendrait à taire une référence fautive. Volontairement strict à
 * gauche en revanche : l'id doit suivre `{{` ou un séparateur d'appel de
 * fonction, sinon `{{formatDate(now; "YYYY")}}` ferait croire à un module 2026.
 */
export function referencedModuleIds(values: string[]): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    for (const expression of value.matchAll(/\{\{([^}]*)\}\}/g)) {
      for (const ref of expression[1].matchAll(/(?:^|[\s(;,+*/-])(\d+)\s*\./g)) {
        ids.add(Number(ref[1]));
      }
    }
  }
  return [...ids];
}

/** Une valeur qui contient une expression : son contenu vient d'ailleurs. */
export function hasExpression(value: string): boolean {
  return value.includes('{{');
}
