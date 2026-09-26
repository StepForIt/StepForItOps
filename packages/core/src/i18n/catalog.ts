/** Un espace de messages : l'anglais fait référence, le français doit en avoir exactement les clés. */
export interface MessageCatalog<K extends string = string> {
  en: Record<K, string>;
  fr: Record<K, string>;
}

export function defineMessages<const T extends Record<string, string>>(
  en: T,
  fr: Record<keyof T & string, string>,
): MessageCatalog<keyof T & string> {
  return { en, fr };
}
