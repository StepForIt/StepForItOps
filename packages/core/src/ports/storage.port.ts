export interface StorageTargetConfig {
  /** Jeton d'accès OAuth (Google Drive). */
  accessToken: string;
  folderId?: string;
}

/** Port de stockage de fichiers externe (ex: Google Drive). */
export interface StoragePort {
  uploadFile(
    config: StorageTargetConfig,
    params: { name: string; content: string; mimeType?: string },
  ): Promise<{ id?: string; url?: string }>;
  /**
   * Réécrit un fichier existant (contenu + nom) au lieu d'en créer un nouveau.
   * `{ missing: true }` si le fichier a disparu côté Drive : l'appelant
   * retombe alors sur `uploadFile`.
   */
  updateFile(
    config: StorageTargetConfig,
    params: { fileId: string; name: string; content: string; mimeType?: string },
  ): Promise<{ id?: string; url?: string; missing?: boolean }>;
  /** Fichiers du dossier configuré (corbeille exclue). */
  listFiles(config: StorageTargetConfig): Promise<Array<{ id: string; name: string }>>;
  /** Contenu texte d'un fichier, `null` s'il n'existe plus. */
  readFile(config: StorageTargetConfig, params: { fileId: string }): Promise<string | null>;
  /** Met un fichier à la corbeille. Ne lève pas s'il n'existe plus. */
  deleteFile(config: StorageTargetConfig, params: { fileId: string }): Promise<{ deleted: boolean }>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
