/**
 * Résolution PURE d'un chemin d'URL vers le nom de l'écran — ce qui va dans
 * `document.title` (onglet, historique, favori, lecteur d'écran) et dans le
 * `<h1>` de la console.
 *
 * Les pages de la console sont des composants client (`'use client'`) : Next
 * n'y accepte pas `export const metadata`, donc le titre par route ne peut pas
 * être statique. On le calcule ici, à partir des routes que la console connaît
 * déjà (les `meta.label` des resources Refine), et on le pose en effet de bord.
 */

export interface ScreenRoute {
  /** Chemin, avec `:param` pour les segments dynamiques (`/workflows/show/:id`). */
  pattern: string;
  label: string;
}

/** Découpe un chemin en segments, barre oblique finale ignorée. */
function segments(path: string): string[] {
  return path.replace(/\/+$/, '').split('/').filter(Boolean);
}

/** Un chemin correspond-il au pattern ? Même nombre de segments, `:param` joker. */
export function matchRoute(pathname: string, pattern: string): boolean {
  const path = segments(pathname);
  const pat = segments(pattern);
  if (path.length !== pat.length) return false;
  return pat.every((segment, index) => segment.startsWith(':') || segment === path[index]);
}

/**
 * Nombre de segments STATIQUES du pattern : sert à départager plusieurs routes
 * qui correspondent — la plus concrète (le moins de jokers) gagne, si bien
 * qu'un `/instances/create` prime sur `/instances/show/:id`.
 */
function staticScore(pattern: string): number {
  return segments(pattern).filter((segment) => !segment.startsWith(':')).length;
}

/** Libellé de l'écran pour ce chemin, ou `null` si aucune route ne correspond. */
export function resolveScreenLabel(pathname: string, routes: ScreenRoute[]): string | null {
  let best: ScreenRoute | null = null;
  let bestScore = -1;
  for (const route of routes) {
    if (!matchRoute(pathname, route.pattern)) continue;
    const score = staticScore(route.pattern);
    if (score > bestScore) {
      best = route;
      bestScore = score;
    }
  }
  return best?.label ?? null;
}

/** Titre d'onglet complet : « <écran> · StepForIt Ops », ou la console seule. */
export function formatDocumentTitle(label: string | null, base = 'StepForIt Ops'): string {
  return label ? `${label} · ${base}` : base;
}
