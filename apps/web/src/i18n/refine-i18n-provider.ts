'use client';

import React from 'react';
import type { I18nProvider } from '@refinedev/core';
import { useLocale, useTranslations } from 'next-intl';
import { setLocale } from './set-locale';

/**
 * Traductions des textes propres à Refine (boutons, notifications, avertissement de sortie).
 * Une clé absente des messages rend le texte par défaut de Refine plutôt que la clé brute.
 */
export function useI18nProvider(): I18nProvider {
  const t = useTranslations();
  const locale = useLocale();
  return React.useMemo<I18nProvider>(
    () => ({
      translate: (key: string, options?: unknown, defaultMessage?: string) => {
        const fallback = typeof options === 'string' ? options : defaultMessage;
        const params =
          typeof options === 'object' && options ? (options as Record<string, string | number>) : {};
        return t.has(key as never) ? t(key as never, params as never) : (fallback ?? key);
      },
      changeLocale: async (next: string) => setLocale(next),
      getLocale: () => locale,
    }),
    [t, locale],
  );
}
