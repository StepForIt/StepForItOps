import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LOCALE, Locale } from './locale';
import { MESSAGES } from './messages';

type Catalogs = typeof MESSAGES;
export type MessageId = {
  [NS in keyof Catalogs & string]: `${NS}.${keyof Catalogs[NS]['en'] & string}`;
}[keyof Catalogs & string];

export type MessageParams = Record<string, string | number | boolean | Date | null | undefined>;

let resolveLocale: () => Locale = () => DEFAULT_LOCALE;

/**
 * Branché par l'application : le domaine ne sait pas d'où vient la langue (requête,
 * réglage de la plateforme), il la demande au moment d'écrire.
 */
export function setLocaleResolver(resolver: () => Locale): void {
  resolveLocale = resolver;
}

export function currentLocale(): Locale {
  return resolveLocale();
}

const formats = new Map<string, IntlMessageFormat>();

function format(locale: Locale, id: MessageId): IntlMessageFormat {
  const cacheKey = `${locale}:${id}`;
  let compiled = formats.get(cacheKey);
  if (!compiled) {
    const dot = id.indexOf('.');
    const catalog = MESSAGES[id.slice(0, dot) as keyof Catalogs] as {
      en: Record<string, string>;
      fr: Record<string, string>;
    };
    compiled = new IntlMessageFormat(catalog[locale][id.slice(dot + 1)], locale);
    formats.set(cacheKey, compiled);
  }
  return compiled;
}

/** Le message dans une langue donnée : pour ce qui part hors requête vers un destinataire connu. */
export function msgIn(locale: Locale, id: MessageId, params?: MessageParams): string {
  return String(format(locale, id).format(params as Record<string, string | number | boolean | Date>));
}

/** Le message dans la langue courante (celle de la requête, sinon celle de la plateforme). */
export function msg(id: MessageId, params?: MessageParams): string {
  return msgIn(resolveLocale(), id, params);
}
