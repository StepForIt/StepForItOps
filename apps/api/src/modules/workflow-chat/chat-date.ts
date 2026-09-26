import { currentLocale } from '@nwm/core';

/** Date et heure écrites dans le fil, au format de la langue de l'écran. */
export function chatDate(date: Date): string {
  return date.toLocaleString(currentLocale() === 'en' ? 'en-GB' : 'fr-FR');
}
