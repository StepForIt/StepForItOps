import { N8nWorkflow } from '../domain/n8n/workflow.types';

export interface N8nInstanceConfig {
  baseUrl: string;
  apiKey: string;
  /**
   * Compte n8n (email + mot de passe), quand il a été saisi. La clé API ouvre
   * `/api/v1` et rien d'autre : la description des types de nœuds est servie par
   * `/types/*.json`, que n8n protège par le cookie de session du navigateur
   * (`server.ts` : « Protect type files with authentication »). Sans ce compte,
   * la plateforme se rabat sur le catalogue mutualisé.
   */
  login?: N8nLogin;
}

export interface N8nLogin {
  email: string;
  password: string;
}

export interface N8nExecutionSummary {
  id: string;
  workflowId: string;
  status: 'success' | 'error' | 'running' | 'waiting' | string;
  startedAt?: string;
  stoppedAt?: string;
  /** trigger | webhook | manual | retry… */
  mode?: string;
  data?: unknown;
}

export interface N8nTag {
  id: string;
  name: string;
}

export interface N8nExecutionsPage {
  executions: N8nExecutionSummary[];
  nextCursor?: string;
}

/** Port d'accès à l'API publique d'une instance n8n. */
export interface N8nApiPort {
  listWorkflows(instance: N8nInstanceConfig): Promise<N8nWorkflow[]>;
  getWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<N8nWorkflow>;
  createWorkflow(instance: N8nInstanceConfig, workflow: N8nWorkflow): Promise<N8nWorkflow>;
  updateWorkflow(
    instance: N8nInstanceConfig,
    workflowId: string,
    workflow: N8nWorkflow,
  ): Promise<N8nWorkflow>;
  activateWorkflow(instance: N8nInstanceConfig, workflowId: string, active: boolean): Promise<void>;
  /**
   * Publie un workflow sur les n8n qui séparent brouillon et publication : la
   * version courante devient celle qui tourne en production. Sur un workflow déjà
   * publié, `updateWorkflow` republie de lui-même — cet appel sert au workflow qui
   * ne l'a jamais été, et c'est alors une mise en production, donc un geste explicite.
   */
  publishWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<void>;
  deleteWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<void>;
  /** `includeData` ramène le détail de chaque exécution (runData) : payload lourd, à limiter. */
  listExecutions(
    instance: N8nInstanceConfig,
    workflowId: string,
    limit?: number,
    options?: { includeData?: boolean; status?: 'success' | 'error' },
  ): Promise<N8nExecutionSummary[]>;
  /** Une exécution précise ; `includeData` ramène le détail (dont l'erreur et le nœud fautif). */
  getExecution(
    instance: N8nInstanceConfig,
    executionId: string,
    options?: { includeData?: boolean },
  ): Promise<N8nExecutionSummary>;
  /** Toutes les exécutions de l'instance (tous statuts), les plus récentes d'abord (paginées). */
  listAllExecutions(
    instance: N8nInstanceConfig,
    options?: { limit?: number; cursor?: string },
  ): Promise<N8nExecutionsPage>;
  /** Exécutions en erreur de toute l'instance, les plus récentes d'abord (paginées). */
  listErrorExecutions(
    instance: N8nInstanceConfig,
    options?: { limit?: number; cursor?: string },
  ): Promise<N8nExecutionsPage>;
  listTags(instance: N8nInstanceConfig): Promise<N8nTag[]>;
  createTag(instance: N8nInstanceConfig, name: string): Promise<N8nTag>;
  setWorkflowTags(instance: N8nInstanceConfig, workflowId: string, tagIds: string[]): Promise<void>;
  /** Déclenche un webhook (test complet d'un workflow). */
  callWebhook(instance: N8nInstanceConfig, path: string, payload: unknown, method?: string): Promise<unknown>;
  /**
   * Description des types de nœuds SERVIS PAR CETTE INSTANCE : sa version de
   * n8n, ses nœuds communautaires installés. Demande un `login` — ces fichiers
   * sont hors de l'API publique. Lève `N8nApiError` si le compte manque ou est
   * refusé, l'appelant retombant alors sur le catalogue mutualisé.
   */
  listNodeTypes(instance: N8nInstanceConfig): Promise<N8nNodeTypeDescription[]>;
  /**
   * `types/node-versions.json` : les `typeVersion` réellement connues de
   * l'instance, par type de nœud. C'est la seule source qui les donne — le
   * catalogue mutualisé ne décrit que la version la plus haute.
   */
  listNodeTypeVersions(instance: N8nInstanceConfig): Promise<Record<string, number[]>>;
  /**
   * Description d'un type de nœud POUR UNE `typeVersion` précise — ce que
   * `/types/nodes.json` ne donne pas : ce fichier sert la description courante
   * du type, quand plus d'un nœud sur deux tourne sur une version antérieure
   * dont les paramètres portaient d'autres noms. C'est la route que l'éditeur
   * n8n appelle lui-même pour dessiner un vieux nœud (`POST /rest/node-types`).
   *
   * Rend ce qui a pu être décrit, jamais moins que rien : une version que
   * l'instance ne connaît pas est simplement absente du résultat — l'appelant
   * retombe alors sur le catalogue mutualisé, comme avant.
   */
  listNodeTypeDescriptions(
    instance: N8nInstanceConfig,
    refs: NodeTypeVersionRef[],
  ): Promise<N8nVersionedNodeType[]>;
}

/** Un type de nœud tel qu'il est EMPLOYÉ : son nom et la version écrite dans le JSON. */
export interface NodeTypeVersionRef {
  name: string;
  version: number;
}

/** La description que l'instance donne de ce couple (type, version). */
export interface N8nVersionedNodeType extends NodeTypeVersionRef {
  description: N8nNodeTypeDescription;
}

/** `INodeTypeDescription` de n8n, réduit à ce que la plateforme en exploite. */
export interface N8nNodeTypeDescription {
  name: string;
  displayName?: string;
  description?: string;
  version?: number | number[];
  defaults?: Record<string, unknown>;
  group?: string[];
  properties?: unknown[];
  credentials?: unknown[];
  webhooks?: unknown[];
  polling?: boolean;
  eventTriggerDescription?: string;
}

export const N8N_API_PORT = Symbol('N8N_API_PORT');
