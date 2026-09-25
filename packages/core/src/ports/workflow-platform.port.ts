/**
 * Le dénominateur commun entre plateformes d'automatisation : lister, lire,
 * écrire, activer, supprimer, et savoir ce qui s'est exécuté.
 *
 * Ce port n'existe PAS pour unifier le contenu d'un workflow — un blueprint Make
 * n'a ni `nodes` ni `connections`, et prétendre le contraire ferait perdre aux
 * contrôles n8n exactement ce qui fait leur valeur. Il unifie ce que le MIROIR a
 * besoin de savoir, et rend le contenu tel quel dans `raw`, à lire par le code de
 * sa plateforme.
 *
 * L'autre moitié du port, et la plus importante, est `capabilities()` : un
 * adapter DÉCLARE ce qu'il ne sait pas faire, et un module l'interroge pour dire
 * « je ne sais pas faire ça ici » au lieu d'afficher un écran vide. Un onglet
 * « Champs » vide sur un scénario Make est pire qu'un onglet absent : il fait
 * croire que le contrôle est passé.
 */

/** Ce qui est déclaré sur `Instance.platform`. */
export type PlatformId = 'n8n' | 'make';

export interface PlatformCapabilities {
  /**
   * Les données produites par une exécution sont lisibles (n8n : `includeData`).
   * Sans elles, pas de schéma réel des sorties (`field-checker`) ni de tokens
   * LLM (`ai-cost`) : ces deux modules ne peuvent alors rien dire.
   */
  executionData: boolean;
  /**
   * D'où vient la description des types de nœuds — quels paramètres existent, de
   * quel type, sous quelle condition. `instance` : la plateforme la sert
   * elle-même. `mcp` : elle vit ailleurs (Make ne l'expose que par son serveur
   * MCP). `none` : le contrôle de conformité au schéma n'a rien à comparer.
   */
  nodeCatalog: 'instance' | 'mcp' | 'none';
  /** Épingler une donnée sur un nœud sans toucher au reste (n8n : `pinData`). */
  pinData: boolean;
  /** Comment se marque l'appartenance d'un workflow : tags libres, labels, rien. */
  labelling: 'tags' | 'labels' | 'none';
  /**
   * Ce que « retiré » veut dire là-bas : un drapeau porté par le workflow
   * (n8n `isArchived`), une corbeille à durée limitée (Make), ou rien.
   */
  archival: 'flag' | 'trash' | 'none';
  /**
   * Plafond d'appels imposé PAR LA PLATEFORME, par minute ; `0` quand elle n'en
   * impose aucun. n8n auto-hébergé ne plafonne rien, Make plafonne à 60 sur son
   * plan d'entrée — ce qui interdit d'y rejouer les passes de masse à 4 de front.
   */
  rateLimitPerMin: number;
  /**
   * Les exécutions se listent pour tout le parc d'un coup, ou workflow par
   * workflow. `per-workflow` transforme un poll en autant d'appels qu'il y a de
   * workflows, et le curseur en curseur par workflow.
   */
  executionListing: 'global' | 'per-workflow';
  /**
   * Le listing rend DÉJÀ le contenu de chaque workflow. n8n : oui, un seul appel
   * suffit. Make : non, il faut un appel de blueprint PAR scénario — ce qui, sous
   * un plafond de 30 requêtes/minute, décide de la façon dont le miroir se
   * resynchronise (ne retélécharger que ce dont `changedAt` a bougé).
   */
  listIncludesContent: boolean;
}

/**
 * Un workflow vu du miroir, SANS son contenu — ce que rend un listing.
 *
 * Le contenu est à part parce que les deux plateformes ne le donnent pas au même
 * prix : n8n le sert avec la liste, Make demande un appel par scénario.
 */
export interface PlatformWorkflowSummary {
  /** L'id chez la plateforme d'origine. `Workflow.externalId` en base. */
  externalId: string;
  name: string;
  active: boolean;
  tags: string[];
  /** Archivé CHEZ ELLE, par opposition à l'archivage doux de la plateforme. */
  archivedUpstream: boolean;
  /**
   * Dernière modification connue côté plateforme, quand elle la donne. C'est ce
   * qui permet de ne pas retélécharger un contenu qui n'a pas bougé — sans quoi
   * une resynchro coûte un appel par workflow, tous les workflows, à chaque fois.
   */
  changedAt?: string;
  /** Renseigné SEULEMENT si `capabilities().listIncludesContent`. */
  raw?: unknown;
}

/** Le même, contenu compris : ce que rend `getWorkflow`. */
export interface PlatformWorkflow extends PlatformWorkflowSummary {
  /** Le contenu brut, non traduit : JSON n8n ou blueprint Make. */
  raw: unknown;
}

export interface PlatformExecution {
  externalId: string;
  workflowExternalId: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt?: string;
  stoppedAt?: string;
  /**
   * La durée telle que la plateforme la donne, quand elle la donne. Make la met
   * DANS son listing ; chez n8n elle se recalcule des deux bornes. La préférer
   * au calcul évite de rendre une durée qui ne correspond à rien quand les deux
   * horodatages n'ont pas la même précision.
   */
  durationMs?: number;
  /** Renseigné pour un échec, quand la plateforme sait dire lequel. */
  error?: { message: string; nodeName?: string };
}

export interface PlatformExecutionsPage {
  executions: PlatformExecution[];
  nextCursor?: string;
}

/** De quoi joindre un compte, quelle que soit la plateforme. */
export interface PlatformInstanceConfig {
  baseUrl: string;
  apiKey: string;
  /** Make : la zone qui sert l'API. n8n : rien, l'URL suffit. */
  zone?: string;
  /** Make : le périmètre listé. n8n : rien, une instance EST le périmètre. */
  orgId?: string;
  teamId?: string;
}

export interface WorkflowPlatformPort {
  readonly platform: PlatformId;
  capabilities(): PlatformCapabilities;

  listWorkflows(instance: PlatformInstanceConfig): Promise<PlatformWorkflowSummary[]>;
  getWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<PlatformWorkflow>;
  /**
   * Remplace le contenu d'un workflow existant par `raw`, tel que `getWorkflow`
   * l'a rendu : JSON n8n ou blueprint Make, jamais traduit. Seul le contenu est
   * écrit — l'état actif, les étiquettes et, chez Make, le planning restent ceux
   * de la plateforme.
   */
  updateWorkflow(instance: PlatformInstanceConfig, externalId: string, raw: unknown): Promise<void>;
  setActive(instance: PlatformInstanceConfig, externalId: string, active: boolean): Promise<void>;
  deleteWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<void>;

  /**
   * `workflowExternalId` est obligatoire quand `executionListing` vaut
   * `per-workflow` : la plateforme ne sait alors pas répondre autrement.
   */
  listExecutions(
    instance: PlatformInstanceConfig,
    opts?: { workflowExternalId?: string; cursor?: string; limit?: number },
  ): Promise<PlatformExecutionsPage>;

  /**
   * Une exécution précise, avec son erreur quand elle a échoué : le message et
   * le nœud fautif. `workflowExternalId` est exigé parce que Make range ses
   * exécutions SOUS le scénario — un id d'exécution seul n'y désigne rien.
   *
   * Rend `null` quand la plateforme ne connaît plus l'exécution (purge), ce qui
   * n'est pas une panne : le détail ne viendra jamais, et l'appelant doit
   * pouvoir le noter plutôt que réessayer indéfiniment.
   */
  getExecution(
    instance: PlatformInstanceConfig,
    opts: { workflowExternalId: string; executionExternalId: string },
  ): Promise<PlatformExecution | null>;
}

export const WORKFLOW_PLATFORM_PORT = Symbol('WorkflowPlatformPort');

/**
 * Les adapters disponibles, par plateforme. C'est ici que se fait la résolution
 * — sur `Instance.platform`, jamais sur une heuristique du contenu — et une
 * plateforme absente de ce registre est une plateforme qu'on ne sait pas servir,
 * ce qui doit se dire au lieu de se deviner.
 */
export const WORKFLOW_PLATFORM_PORTS = Symbol('WorkflowPlatformPorts');
export type WorkflowPlatformPorts = Partial<Record<PlatformId, WorkflowPlatformPort>>;

/**
 * Ce que n8n sait faire. Écrit ici plutôt que dans l'adapter parce que c'est une
 * PROPRIÉTÉ DE LA PLATEFORME et non de notre implémentation : le jour où l'on
 * relit ce tableau pour savoir pourquoi un module se tait, c'est n8n qu'on relit.
 */
export const N8N_CAPABILITIES: PlatformCapabilities = {
  executionData: true,
  nodeCatalog: 'instance',
  pinData: true,
  labelling: 'tags',
  archival: 'flag',
  rateLimitPerMin: 0,
  executionListing: 'global',
  listIncludesContent: true,
};

/**
 * Ce que Make sait faire — et surtout ce qu'il ne sait pas.
 *
 * `executionData: false` est le plus lourd de conséquences : l'API rend le
 * statut d'une exécution, son erreur et le module fautif, mais JAMAIS les
 * bundles. Seules les exécutions PLANTÉES en gardent (`/dlqs/{id}/bundle`).
 * `field-checker` et `ai-cost` n'ont donc rien à lire chez Make.
 *
 * `rateLimitPerMin` n'est qu'un plancher prudent : la vraie limite se lit à
 * l'exécution dans `license.apiLimit` de l'organisation (30 sur un plan Free,
 * 1 000 en Enterprise), et l'adapter s'y règle tout seul.
 */
export const MAKE_CAPABILITIES: PlatformCapabilities = {
  executionData: false,
  nodeCatalog: 'mcp',
  pinData: false,
  labelling: 'labels',
  archival: 'trash',
  rateLimitPerMin: 30,
  executionListing: 'per-workflow',
  listIncludesContent: false,
};
