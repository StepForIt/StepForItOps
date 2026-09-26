import { AsyncLocalStorage } from 'node:async_hooks';
import { Locale } from '@nwm/core';

const storage = new AsyncLocalStorage<Locale>();

/** Langue de la requête en cours ; `undefined` hors requête (cron, événement). */
export function requestLocale(): Locale | undefined {
  return storage.getStore();
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}
