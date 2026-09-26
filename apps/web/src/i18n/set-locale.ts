import { LOCALE_COOKIE, isLocale } from './locale';

/** Pose le choix de langue puis recharge : messages et locale antd viennent du rendu serveur. */
export function setLocale(locale: string): void {
  if (!isLocale(locale)) return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
