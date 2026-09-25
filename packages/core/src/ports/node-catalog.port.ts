import { NodeProperty } from '../domain/n8n/node-schema';

/**
 * Un type de nœud tel qu'une source amont le décrit.
 *
 * `nodeType` est toujours en forme LONGUE (`n8n-nodes-base.slack`) : c'est celle
 * du JSON n8n, donc la seule sur laquelle on peut joindre un nœud de workflow.
 * La conversion depuis la forme courte du catalogue mutualisé est faite par
 * l'adapter, jamais par l'appelant (`node-type-name.ts`).
 */
export interface CatalogNodeType {
  nodeType: string;
  packageName: string;
  displayName: string;
  description?: string;
  /** Version la plus haute décrite. */
  version?: number;
  isTrigger: boolean;
  isWebhook: boolean;
  isVersioned: boolean;
  properties: NodeProperty[];
  /** resource + operation déclarées, quand la source les expose. */
  operations?: unknown;
  credentialsRequired?: unknown;
  /** Doc officielle du nœud, en markdown, quand la source l'embarque. */
  documentation?: string;
}

/** Ce que l'amont dit de sa propre version, pour ne réimporter que du neuf. */
export interface CatalogRevision {
  /** Identifiant opaque de la version amont (sha de blob, tag de release…). */
  revision: string;
  /** Version de n8n que ce catalogue décrit, si la source la donne. */
  n8nVersion?: string;
}

/**
 * Port d'accès à un catalogue de types de nœuds n8n.
 *
 * Il n'existe que pour l'INGESTION : une fois les types en base, plus personne
 * n'appelle l'amont. C'est le point du cahier des charges — le catalogue doit
 * survivre à la disparition de sa source.
 */
export interface NodeCatalogPort {
  /** Nom de la source, tel qu'il apparaît dans le journal de synchronisation. */
  readonly sourceName: string;
  /** Version amont courante, lue sans télécharger le catalogue entier. */
  revision(): Promise<CatalogRevision>;
  /**
   * Types de nœuds de l'amont. `includeCommunity` est faux par défaut : les
   * 1 784 nœuds communautaires pèsent l'essentiel du catalogue amont pour une
   * utilité que la plupart des instances n'ont pas.
   */
  fetch(options?: { includeCommunity?: boolean }): Promise<CatalogNodeType[]>;
}

export const NODE_CATALOG_PORT = Symbol('NodeCatalogPort');
