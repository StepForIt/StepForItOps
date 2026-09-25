/**
 * Genre d'un problème (auth, rate-limit, timeout, réseau, données) — tri de
 * premier regard, pas un diagnostic : en doute, `other`. L'ordre des règles
 * compte (« 429 Too Many Requests » = rate limit avant code HTTP) et on
 * catégorise le message BRUT : le pattern normalisé a perdu ses codes HTTP.
 *
 * Les règles étaient écrites sur le vocabulaire de n8n, qui rend des codes
 * système (`ECONNREFUSED`) ; Make rend des noms de classe (`ConnectionError`)
 * et de l'anglais courant. Les deux vocabulaires cohabitent ici — un genre est
 * un genre, quelle que soit la plateforme qui l'a formulé.
 *
 * Trois erreurs Make restent volontairement en `other` : `RuntimeError` (« échec
 * inattendu », rien à en tirer), `InvalidConfigurationError` (un module mal
 * réglé n'est ni une donnée fautive ni une panne — le ranger dans `data`
 * enverrait chercher un payload qui n'y est pour rien) et
 * `MaxFileSizeExceededError` (une limite, pas un genre de panne).
 */

export type ErrorCategory = 'auth' | 'rate-limit' | 'timeout' | 'network' | 'data' | 'other';

export const ERROR_CATEGORIES: ErrorCategory[] = [
  'auth',
  'rate-limit',
  'timeout',
  'network',
  'data',
  'other',
];

const RULES: Array<[ErrorCategory, RegExp]> = [
  ['rate-limit', /rate.?limit|too many requests|\b429\b|quota|throttl/i],
  [
    'auth',
    /\b401\b|\b403\b|unauthori[sz]|forbidden|authenticat|invalid (api.?)?key|api.?key|credential|token.{0,12}(expired|invalid|revoked)|expired token|permission|access denied|login required/i,
  ],
  ['timeout', /time[d]?.?out|etimedout|esockettimedout|deadline exceeded|aborted after/i],
  [
    'network',
    /econnrefused|econnreset|enotfound|eai_again|ehostunreach|epipe|socket hang up|getaddrinfo|dns|fetch failed|network|\b50[234]\b|bad gateway|service unavailable|gateway time|connectionerror|connection (refused|reset|aborted|closed)|cannot connect/i,
  ],
  [
    'data',
    /cannot read|undefined is not|is not defined|unexpected token|json|parse|invalid (input|value|format|url)|validation|required (field|propert|parameter)|missing (field|propert|parameter|required)|no data|not (be )?found|\b404\b|\b400\b|bad request|duplicate|unique constraint|dataerror|inconsistency/i,
  ],
];

/** Catégorie d'un message d'erreur brut ; `other` faute d'indice clair. */
export function categorizeError(message: string | null | undefined): ErrorCategory {
  if (!message) return 'other';
  for (const [category, pattern] of RULES) {
    if (pattern.test(message)) return category;
  }
  return 'other';
}
