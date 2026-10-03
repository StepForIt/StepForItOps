/**
 * Fichier de sauvegarde complète : du NDJSON compressé (`.ndjson.gz`), une ligne
 * par enregistrement. Pas un seul objet JSON : l'historique d'un parc (versions,
 * exécutions, erreurs) pèse des centaines de Mo, et un JSON unique devrait tenir
 * entier en mémoire des deux côtés. Ligne à ligne, il s'écrit et se relit en flux.
 *
 * 1. l'en-tête ;
 * 2. `{ t, r }` pour chaque ligne de chaque table, table après table, dans
 *    l'ordre des clés étrangères ; les tables de jointure n-n à la fin ;
 * 3. le marqueur de fin — sans lui le fichier a été coupé en route, et une
 *    restauration partielle est pire qu'aucune.
 */

export const BACKUP_KIND = 'nwm-backup';
export const BACKUP_VERSION = 1;

export interface BackupHeader {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  /** Dernière migration appliquée à la base source (null si la base vient d'un `db push`). */
  schema: string | null;
  /** Nombre de lignes annoncées par table, dans l'ordre du fichier. */
  tables: { table: string; count: number }[];
}

export interface BackupRowLine {
  t: string;
  r: Record<string, unknown>;
}

export interface BackupEndLine {
  end: true;
  rows: number;
}

export interface RestoreTablePreview {
  table: string;
  /** Lignes présentes dans le fichier. */
  inFile: number;
  /** Lignes présentes aujourd'hui, qui seront remplacées. */
  current: number;
}

export interface RestorePreview {
  uploadId: string;
  exportedAt: string;
  schema: string | null;
  currentSchema: string | null;
  tables: RestoreTablePreview[];
  totalRows: number;
  warnings: string[];
}

export interface RestoreResult {
  restoredRows: number;
  tables: { table: string; rows: number }[];
  warnings: string[];
}
