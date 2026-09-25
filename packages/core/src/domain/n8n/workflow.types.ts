/** Types miroir (partiels) du JSON d'un workflow n8n. */

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  /** Requis sur les nœuds webhook : sans lui, n8n n'enregistre pas le webhook de prod à l'activation. */
  webhookId?: string;
  position?: [number, number];
  disabled?: boolean;
  notes?: string;
  /** false = la note n'est visible que dans le panneau du nœud, pas sur le canvas. */
  notesInFlow?: boolean;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
  /** `continueRegularOutput` : l'erreur descend dans le flux au lieu d'avorter l'exécution. */
  onError?: string;
  /** Forme historique de `onError: 'continueRegularOutput'` (workflows d'avant n8n 1.x). */
  continueOnFail?: boolean;
  /** Le nœud rejoue lui-même l'opération en cas d'échec (Settings → Retry on Fail). */
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  /** Fait sortir un item même quand le nœud n'a rien produit (une erreur, typiquement). */
  alwaysOutputData?: boolean;
}

/** connections[sourceNodeName][outputType][outputIndex] = [{ node, type, index }] */
export type N8nConnections = Record<
  string,
  Record<string, Array<Array<{ node: string; type: string; index: number }>>>
>;

export interface N8nWorkflow {
  id?: string;
  name: string;
  active?: boolean;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: Record<string, unknown>;
  pinData?: Record<string, unknown>;
  tags?: Array<{ id?: string; name: string }> | string[];
  /** Archivage natif n8n (≥ 1.x) : le workflow n'est plus modifiable via l'API. */
  isArchived?: boolean;
  /**
   * Version publiée, sur les n8n qui séparent brouillon et publication. En lecture
   * seule côté API publique : la clé RENSEIGNE le modèle de l'instance, elle ne se
   * pilote pas. `null` = aucune version publiée, donc un workflow que l'éditeur
   * n8n ne sait plus ouvrir. Absente = n8n d'avant ce modèle.
   */
  activeVersionId?: string | null;
  /** Dernière modification dans n8n (ISO). */
  updatedAt?: string;
  meta?: Record<string, unknown>;
}
