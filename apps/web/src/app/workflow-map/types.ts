/** Types du schéma workflow → workflow renvoyé par `GET /workflow-map`. */

/** Façons de démarrer un workflow. */
export type TriggerKind =
  'manual' | 'schedule' | 'webhook' | 'form' | 'chat' | 'sub-workflow' | 'error' | 'app';

export interface WorkflowMapNode {
  /** Id du workflow, ou `ext:<clé>` pour une cible appelée mais non synchronisée. */
  id: string;
  name: string;
  external: boolean;
  instanceId?: string;
  active?: boolean;
  archived?: boolean;
  /** Façons de démarrer ce workflow (triggers désactivés exclus). */
  triggers?: TriggerKind[];
  /** Ce qui met ce workflow en route : URL publique, ou libellé (« planifié », « Telegram »…). */
  entryPoints?: { kind: TriggerKind; label: string; nodeName: string }[];
  env?: string | null;
  externalId?: string;
}

export interface WorkflowMapLink {
  id: string;
  origin: 'auto' | 'manual';
  /** execute | tool | webhook (détecté) ou manual (saisi). */
  kind: string;
  fromId: string;
  toId: string;
  label?: string;
  note?: string;
  nodeNames?: string[];
  /**
   * D'où part l'appel quand ce n'est pas un flux ordinaire, et la taille de ce bout de
   * workflow : boucle, bouton de test (`manual`), branche de sous-workflow.
   */
  context?: { kind: 'loop' | 'manual' | 'sub-workflow'; nodeCount: number };
}
