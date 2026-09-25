/** Remplacement profond de sous-chaînes exactes dans toutes les strings d'un JSON. */

export interface Replacement {
  from: string;
  to: string;
}

export interface ReplacementHit {
  path: string;
  from: string;
  to: string;
}

/** Prévisualise les remplacements sans modifier l'objet. */
export function previewDeepReplace(
  value: unknown,
  replacements: Replacement[],
  path = '$',
): ReplacementHit[] {
  const hits: ReplacementHit[] = [];
  if (typeof value === 'string') {
    for (const r of replacements) {
      if (r.from && value.includes(r.from)) hits.push({ path, from: r.from, to: r.to });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...previewDeepReplace(item, replacements, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      hits.push(...previewDeepReplace(child, replacements, `${path}.${key}`));
    }
  }
  return hits;
}

/** Applique les remplacements et retourne une copie. */
export function applyDeepReplace<T>(value: T, replacements: Replacement[]): T {
  if (typeof value === 'string') {
    let result: string = value;
    for (const r of replacements) {
      if (r.from) result = result.split(r.from).join(r.to);
    }
    return result as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyDeepReplace(item, replacements)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        applyDeepReplace(v, replacements),
      ]),
    ) as unknown as T;
  }
  return value;
}
