import { Locale } from './locale';
import { currentLocale } from './translate';

const LANGUAGE_NAMES: Record<Locale, string> = { fr: 'French', en: 'English' };

export function languageName(locale: Locale = currentLocale()): string {
  return LANGUAGE_NAMES[locale];
}

/**
 * Consigne de prompt pour ce que l'IA écrit à destination d'un humain (message, note de
 * nœud, nom, résumé) : les prompts sont en anglais, la sortie suit la langue d'affichage.
 */
export function writeInLanguage(locale: Locale = currentLocale()): string {
  return `Write every human-readable text you produce (explanations, messages, node notes, sticky notes, names, summaries) in ${LANGUAGE_NAMES[locale]}. Keep identifiers, code and JSON keys unchanged.`;
}

/**
 * Consigne du chat : la réponse suit la langue du message reçu ; ce qui s'écrit dans le
 * workflow suit la langue d'affichage de la console, puisque toute l'équipe le relira.
 */
export function replyInUserLanguage(display: Locale = currentLocale()): string {
  return `Reply in the language of the user's latest message (if unclear, in ${LANGUAGE_NAMES[display]}). Texts you write into the workflow itself (node notes, sticky notes, node or workflow names) are in ${LANGUAGE_NAMES[display]}.`;
}
