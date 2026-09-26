import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale } from './locale';
import { MESSAGES } from './messages';

/** Pas de préfixe de langue dans l'URL : la langue suit le cookie, sinon le navigateur. */
export default getRequestConfig(async () => {
  const locale = resolveLocale(cookies().get(LOCALE_COOKIE)?.value, headers().get('accept-language'));
  return { locale, messages: MESSAGES[locale], timeZone: process.env.TZ || 'Europe/Paris' };
});
