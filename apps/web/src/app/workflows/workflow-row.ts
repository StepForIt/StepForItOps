export type WorkflowActionId =
  | 'export'
  | 'test'
  | 'envSwitch'
  | 'assistant'
  | 'doc'
  | 'naming'
  | 'fields'
  | 'remoteSchema'
  | 'publish'
  | 'verify'
  | 'sync';

/** Écart d'un exemplaire avec la prod du même workflow métier (empreinte de déploiement). */
export interface WorkflowDivergence {
  status: 'in-sync' | 'ahead' | 'behind' | 'not-deployed' | 'unknown';
  referenceEnv: string;
  referenceIds: string[];
}

/** Ligne de la liste des workflows, telle que renvoyée par `GET /workflows`. */
export interface WorkflowRow {
  id: string;
  instanceId: string;
  name: string;
  active: boolean;
  tags: string[];
  /** Id de l'env déclaré, ou null quand ni le nom ni les tags ne le disent. */
  env: string | null;
  n8nUrl: string;
  monitorCount: number;
  archived: boolean;
  /** Archivé dans n8n même : l'API publique n'y touche plus, le retour se fait dans n8n. */
  archivedUpstream: boolean;
  /** n8n ne connaît plus ce workflow ; la copie locale et son historique restent. */
  missingInN8n: boolean;
  missingUpstreamAt: string | null;
  /**
   * Publié, sur les n8n qui séparent brouillon et version publiée ; `null` sur une
   * instance qui ne les sépare pas. `false` explique à lui seul un workflow que
   * l'éditeur n8n renvoie vers « Nouveau workflow » : il ouvre la version publiée.
   */
  published: boolean | null;
  /** La plateforme qui sert ce workflow : n8n ou un compte Make. */
  platform: 'n8n' | 'make';
  /**
   * Ce que l'écran a le droit de proposer, calculé par l'API. Un bouton qui
   * échoue apprend quelque chose de faux — que la plateforme est cassée, alors
   * qu'elle n'a simplement pas cette fonction là-bas.
   */
  actions: Record<WorkflowActionId, { available: boolean; why?: string; reason?: 'platform' | 'not-yet' }>;
  /** Groupes métier auxquels il appartient (vide si le module est désactivé ou s'il n'en a aucun). */
  groups?: Array<{ id: string; name: string }>;
  /** Null pour la prod elle-même et pour un env non déduit. */
  divergence?: WorkflowDivergence | null;
  updatedAt: string;
  upstreamUpdatedAt: string | null;
}

/** Un workflow métier et ses déclinaisons par environnement (`GET /workflows/families`). */
export interface WorkflowFamily {
  id: string;
  name: string;
  envs: string[];
  unknownEnvCount: number;
  instanceIds: string[];
  memberCount: number;
  activeCount: number;
  archivedCount: number;
  missingCount: number;
  /** Envs dont un exemplaire est à déployer vers la prod. */
  toDeploy: string[];
  /** La prod a bougé après un de ses exemplaires : un correctif fait là-bas. */
  prodAhead: boolean;
  updatedAt: string;
  upstreamUpdatedAt: string | null;
  members: WorkflowRow[];
}

/**
 * Sélection des actions groupées, tenue par la page : la vue plate et la vue
 * groupée cochent les mêmes workflows, et une famille dépliée n'a pas de
 * sélection à elle. `onSelect` remplace la sélection des lignes de `scope`
 * (la page du tableau, ou les membres d'une famille) par `rows`, sans toucher
 * au reste — sinon cocher une ligne d'une famille effacerait les autres.
 */
export interface WorkflowSelection {
  ids: string[];
  onSelect: (scope: WorkflowRow[], rows: WorkflowRow[]) => void;
}

/**
 * Sélection des workflows MÉTIER de la vue groupée : elle ne sert qu'aux gestes
 * d'environnement, qui décident eux-mêmes quel exemplaire part. Les actions sur
 * les exemplaires gardent leur propre sélection.
 */
export interface FamilySelection {
  keys: string[];
  onSelect: (scope: WorkflowFamily[], rows: WorkflowFamily[]) => void;
}
