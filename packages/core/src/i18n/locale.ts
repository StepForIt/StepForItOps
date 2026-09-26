/** Langues servies. La première est celle d'une installation sans préférence. */
export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

/** En-tête posé par le proxy de la console : la langue d'affichage de l'appelant. */
export const LOCALE_HEADER = 'x-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Première langue servie parmi celles qu'annonce un `Accept-Language`, dans l'ordre
 * de ses poids `q` ; `undefined` quand aucune ne l'est, pour laisser l'appelant choisir le repli.
 */
export function localeFromAcceptLanguage(acceptLanguage: string | null | undefined): Locale | undefined {
  return (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.lang && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.lang)
    .find(isLocale);
}
