/** Lecture des paramètres d'un nœud n8n (valeurs brutes ou resourceLocator). */

/** n8n préfixe par `=` les valeurs saisies en mode expression ; sans `{{` la valeur est en fait statique. */
function normalize(s: string): string | undefined {
  const cleaned = s.startsWith('=') && !s.includes('{{') ? s.slice(1) : s;
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Valeur d'un paramètre : chaîne directe ou `value` d'un resourceLocator (`{ __rl: true, value, mode }`). */
export function paramString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return normalize(v);
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const value = (v as Record<string, unknown>).value;
    if (typeof value === 'string' && value.length > 0) return normalize(value);
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

/** Nom lisible d'un resourceLocator n8n (`cachedResultName`), si présent. */
export function paramLabel(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'cachedResultName' in (v as Record<string, unknown>)) {
    const cached = (v as Record<string, unknown>).cachedResultName;
    return typeof cached === 'string' && cached.length > 0 ? cached : undefined;
  }
  return undefined;
}
