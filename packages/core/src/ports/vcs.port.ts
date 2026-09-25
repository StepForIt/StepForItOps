export interface VcsTargetConfig {
  owner: string;
  repo: string;
  branch?: string;
  token: string;
}

export interface VcsRepo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** Port de versionnement externe (ex: GitHub). */
export interface VcsPort {
  commitFile(
    config: VcsTargetConfig,
    params: { path: string; content: string; message: string },
  ): Promise<{ url?: string }>;
  /**
   * Supprime un fichier. Sert à « déplacer » un workflow renommé (commit du
   * nouveau chemin + suppression de l'ancien) sans laisser de doublon.
   * Ne lève pas si le fichier n'existe pas.
   */
  deleteFile(
    config: VcsTargetConfig,
    params: { path: string; message: string },
  ): Promise<{ deleted: boolean }>;
  /** Chemins de tous les fichiers sous `path` (récursif). */
  listFiles(config: VcsTargetConfig, params: { path: string }): Promise<string[]>;
  /** Contenu texte d'un fichier, `null` s'il n'existe pas. */
  readFile(config: VcsTargetConfig, params: { path: string }): Promise<string | null>;
  /** Vérifie que le token accède bien au repo (et à la branche si fournie). */
  testAccess(config: VcsTargetConfig): Promise<{ ok: boolean; error?: string }>;
  /** Repos accessibles par le token (perso + orgs). */
  listRepos(token: string): Promise<VcsRepo[]>;
  /** Branches d'un repo. */
  listBranches(config: Omit<VcsTargetConfig, 'branch'>): Promise<string[]>;
}

export const VCS_PORT = Symbol('VCS_PORT');
