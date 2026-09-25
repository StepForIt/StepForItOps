/** Tag n8n posé sur les workflows archivés depuis la plateforme. */
export const ARCHIVED_TAG = 'archived';
/** Préfixe ajouté au nom du workflow archivé (visible dans l'UI n8n). */
export const ARCHIVED_PREFIX = '[ARCHIVED] ';

/**
 * Un workflow est considéré archivé s'il porte le tag `archived`
 * ou si son nom commence par le préfixe `[ARCHIVED]`.
 */
export function isWorkflowArchived(name: string, tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === ARCHIVED_TAG) || name.startsWith(ARCHIVED_PREFIX.trimEnd());
}

/** "Facturation" → "[ARCHIVED] Facturation" (idempotent). */
export function withArchivedPrefix(name: string): string {
  return name.startsWith(ARCHIVED_PREFIX.trimEnd()) ? name : `${ARCHIVED_PREFIX}${name}`;
}

/** "[ARCHIVED] Facturation" → "Facturation". */
export function withoutArchivedPrefix(name: string): string {
  return name.startsWith(ARCHIVED_PREFIX.trimEnd())
    ? name.slice(ARCHIVED_PREFIX.trimEnd().length).trimStart()
    : name;
}
