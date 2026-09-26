'use client';

import React from 'react';
import * as Sentry from '@sentry/nextjs';
import frMisc from '../../messages/fr/misc.json';
import enMisc from '../../messages/en/misc.json';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, resolveLocale, type Locale } from '../i18n/locale';

const TEXTS: Record<Locale, { title: string; retry: string }> = {
  fr: frMisc.globalError,
  en: enMisc.globalError,
};

/** Rendu hors du layout, donc sans `NextIntlClientProvider` : la langue se relit dans la page. */
function currentLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const cookie = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  const lang = document.documentElement.lang;
  if (isLocale(cookie)) return cookie;
  if (isLocale(lang)) return lang;
  return resolveLocale(undefined, navigator.language);
}

/**
 * Dernier filet du front : une erreur de rendu qui remonte jusqu'ici a emporté
 * la mise en page entière (Refine et antd compris), d'où le HTML nu.
 *
 * C'est le seul endroit où une erreur du navigateur est capturée : le reste du
 * temps, ce qui casse est un appel à l'API, et l'API le remonte de son côté.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  const [locale] = React.useState(currentLocale);
  const text = TEXTS[locale];

  return (
    <html lang={locale}>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <h1 style={{ fontSize: 20 }}>{text.title}</h1>
        <p style={{ color: '#666' }}>
          {error.message}
          {error.digest ? ` (${error.digest})` : ''}
        </p>
        <button type="button" onClick={reset} style={{ padding: '6px 14px', cursor: 'pointer' }}>
          {text.retry}
        </button>
      </body>
    </html>
  );
}
