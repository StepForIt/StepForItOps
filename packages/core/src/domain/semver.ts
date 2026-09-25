/**
 * Version sémantique d'un workflow. C'est la PROMOTION qui fait la release :
 * éditer en dev ne bouge rien, promouvoir aligne tous les exemplaires du chemin
 * sur un même numéro — deux exemplaires au même contenu portent la même version,
 * et l'écart entre deux envs se lit d'un coup d'œil.
 */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export type BumpLevel = 'major' | 'minor' | 'patch';

/**
 * Ce qu'une promotion fait au numéro. La reprise (`none`) n'est pas un incrément
 * de zéro : c'est le refus d'en faire un, parce que le contenu qui part est déjà
 * celui que la source porte sous son numéro — le numéro identifie un CONTENU, pas
 * un geste, et repousser le même workflow d'un env au suivant ne publie rien.
 */
export type ReleaseLevel = BumpLevel | 'none';

/** Première version d'un workflow qui n'en avait pas. */
export const INITIAL_VERSION = '1.0.0';

const PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(value: string | null | undefined): Semver | null {
  const match = PATTERN.exec((value ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Négatif si `a` précède `b`, positif s'il le suit, 0 à égalité. */
export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** La plus haute d'une liste, les valeurs illisibles ignorées. Null si aucune n'est lisible. */
export function maxSemver(values: Array<string | null | undefined>): string | null {
  const parsed = values.map(parseSemver).filter((v): v is Semver => v !== null);
  if (parsed.length === 0) return null;
  return formatSemver(parsed.reduce((max, v) => (compareSemver(v, max) > 0 ? v : max)));
}

export function bumpSemver(version: Semver, level: BumpLevel): Semver {
  if (level === 'major') return { major: version.major + 1, minor: 0, patch: 0 };
  if (level === 'minor') return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

/**
 * Prochaine version à partir de la plus haute du chemin : promouvoir une dev en
 * 1.2.10 vers une prod déjà en 1.2.10 donne 1.2.11 pour TOUT le chemin. Repartir
 * de la seule source rejouerait un numéro déjà servi ailleurs.
 */
export function nextVersion(current: Array<string | null | undefined>, level: BumpLevel): string {
  const highest = maxSemver(current);
  if (!highest) return INITIAL_VERSION;
  return formatSemver(bumpSemver(parseSemver(highest)!, level));
}
