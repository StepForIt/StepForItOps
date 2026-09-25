/** Chemin de fichier d'une version dans les cibles d'export (GitHub / Drive). */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** L'id n8n est sensible à la casse : on l'assainit sans le transformer. */
function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

/**
 * `<instance>/<workflow>--<externalId>.json` — préfixé par `workflows/` côté GitHub.
 * Le nom reste lisible mais c'est le externalId qui identifie le fichier : un
 * renommage déplace le fichier au lieu d'en créer un doublon (cf.
 * `WorkflowExportRef` et `VersionExportService`).
 */
export function versionFileName(instanceName: string, workflowName: string, externalId: string): string {
  return `${slugify(instanceName)}/${slugify(workflowName)}--${safeId(externalId)}.json`;
}

/**
 * Chemin utilisé avant l'introduction du externalId dans le nom de fichier.
 * Sert une seule fois, au premier export d'un workflow sans `WorkflowExportRef`,
 * pour supprimer l'ancien fichier au lieu de le laisser en doublon.
 */
export function legacyVersionFileName(instanceName: string, workflowName: string): string {
  return `${slugify(instanceName)}/${slugify(workflowName)}.json`;
}

/** Google Drive est plat : le dossier devient un préfixe du nom de fichier. */
export function driveFileName(fileName: string, archived = false): string {
  const flat = fileName.replace('/', '__');
  return archived ? `${ARCHIVED_EXPORT_DIR}__${flat}` : flat;
}

/** Racine des exports dans le repo GitHub. */
export const GITHUB_EXPORT_ROOT = 'workflows';

/**
 * Sous-dossier des workflows retirés côté n8n (archivés nativement ou
 * supprimés). Le fichier y est DÉPLACÉ, jamais supprimé : la sauvegarde d'un
 * workflow que n8n ne connaît plus est justement celle qui vaut le plus cher.
 */
export const ARCHIVED_EXPORT_DIR = 'archived';

export function githubPath(fileName: string, archived = false): string {
  return archived
    ? `${GITHUB_EXPORT_ROOT}/${ARCHIVED_EXPORT_DIR}/${fileName}`
    : `${GITHUB_EXPORT_ROOT}/${fileName}`;
}

/**
 * Emplacement attendu d'un workflow dans une cible : même calcul pour l'export,
 * le rangement des retirés et le nettoyage des doublons, qui se contrediraient
 * sinon (un fichier rangé passerait pour un doublon à supprimer).
 */
export function exportLocation(
  kind: string,
  instanceName: string,
  workflowName: string,
  externalId: string,
  archived: boolean,
): string {
  const fileName = versionFileName(instanceName, workflowName, externalId);
  return kind === 'github' ? githubPath(fileName, archived) : driveFileName(fileName, archived);
}

/** externalId lu dans un nom de fichier au nouveau format, `null` si ancien format. */
export function n8nIdFromFileName(fileName: string): string | null {
  return /--([A-Za-z0-9_-]+)\.json$/.exec(fileName)?.[1] ?? null;
}
