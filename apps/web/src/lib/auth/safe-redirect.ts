/**
 * Nettoyage de la destination post-login (`?next=`).
 *
 * Un `next` vient de l'URL, donc de l'extérieur : sans filtre, `?next=https://…`
 * transformerait la page de login en redirecteur ouvert (phishing). On ne garde
 * que des chemins internes.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return '/';
  // Chemin absolu interne uniquement : pas d'URL absolue (`https://…`), pas de
  // `//host` (protocol-relative), pas de `\` (interprété comme `/` par certains
  // navigateurs).
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login') || next.startsWith('/auth/')) return '/';
  return next;
}
