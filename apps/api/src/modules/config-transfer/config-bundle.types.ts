/**
 * Format du fichier de configuration échangé entre deux instances de la plateforme.
 * Les entrées sont identifiées par des clés naturelles (pas d'id DB) pour être
 * ré-importables sur une base qui a ses propres uuids.
 */

import { EnvDefinition } from '@nwm/core';

export const CONFIG_BUNDLE_KIND = 'nwm-config';
export const CONFIG_BUNDLE_VERSION = 1;

/**
 * Référence portable vers un workflow : les ids DB diffèrent d'une base à l'autre,
 * seul le couple (URL de l'instance, id n8n) est stable. Résolue à l'import — donc
 * seulement si les workflows ont déjà été synchronisés depuis n8n sur la cible.
 */
export interface WorkflowRef {
  instanceBaseUrl: string;
  externalId: string;
}

export interface InstanceEntry {
  name: string;
  baseUrl: string;
  /** null quand les secrets ont été exclus de l'export. */
  apiKey: string | null;
}

export interface ExportTargetEntry {
  kind: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface ResourceMappingEntry {
  provider: string;
  logicalName: string;
  values: Record<string, unknown>;
}

export interface MonitorEntry {
  name: string;
  kind: string;
  /** Conservé à l'import : les workflows n8n pointent déjà /beat/:token. */
  token: string;
  kumaPushUrl: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  /** Référence portable vers le workflow lié (résolue à l'import si possible). */
  workflowRef: WorkflowRef | null;
  /**
   * URL de l'instance visée par `config.instanceId` (error-watch) : cet uuid est local,
   * recopié tel quel il viserait une instance inexistante sur la cible.
   * Absent des bundles produits avant l'ajout du champ.
   */
  instanceRef?: string | null;
}

export interface MonitoringSettingsEntry {
  id: string;
  kumaUrl: string | null;
  kumaUsername: string | null;
  /** null quand les secrets ont été exclus de l'export. */
  kumaPassword: string | null;
}

export interface AiSettingsEntry {
  /** Fournisseur : "anthropic" | "mistral". */
  id: string;
  model: string | null;
  /** null quand les secrets ont été exclus de l'export. */
  apiKey: string | null;
  /** Absent des bundles antérieurs au choix de fournisseur : tolérer undefined. */
  active?: boolean;
}

export interface ModuleStateEntry {
  id: string;
  enabled: boolean;
  settings: Record<string, unknown> | null;
}

export interface PlatformSettingsEntry {
  id: string;
  includeArchived: boolean;
  /**
   * Environnements déclarés. Ils voyagent avec la config : sans eux, la plateforme
   * d'arrivée ne saurait plus lire l'env d'un « Sync - RECETTE ».
   */
  envs?: EnvDefinition[];
  envChainMode?: string;
}

/**
 * Règle « ce finding est normal ». workflowRef et familyKey tous deux null =
 * portée globale ; familyKey seul = le workflow métier dans tous ses environnements.
 * La clé de famille se dérive du nom : elle voyage telle quelle, sans résolution.
 */
export interface FindingIgnoreEntry {
  module: string;
  code: string;
  nodeName: string | null;
  /** Id n8n du nœud : vit dans le JSON du workflow, donc valable sur l'autre plateforme. */
  nodeId?: string | null;
  /** Message du finding d'origine (l'empreinte d'appariement est recalculée à l'import). */
  message?: string | null;
  reason: string | null;
  workflowRef: WorkflowRef | null;
  familyKey: string | null;
  /** Ancre de la portée famille, en clé naturelle : l'uuid local ne vaut rien ailleurs. */
  familyWorkflowRef?: WorkflowRef | null;
}

export interface WorkflowGroupEntry {
  instanceBaseUrl: string;
  name: string;
  /** Ids n8n des workflows membres, résolus à l'import (les absents sont signalés). */
  workflowN8nIds: string[];
}

/** Lien manuel de la carte des workflows. */
export interface WorkflowLinkEntry {
  from: WorkflowRef;
  to: WorkflowRef;
  label: string;
  note: string | null;
}

export interface ConfigBundle {
  kind: typeof CONFIG_BUNDLE_KIND;
  version: typeof CONFIG_BUNDLE_VERSION;
  exportedAt: string;
  includesSecrets: boolean;
  instances: InstanceEntry[];
  exportTargets: ExportTargetEntry[];
  resourceMappings: ResourceMappingEntry[];
  monitors: MonitorEntry[];
  monitoringSettings: MonitoringSettingsEntry[];
  /** Absent des bundles antérieurs à l'ajout des réglages IA : tolérer undefined. */
  aiSettings?: AiSettingsEntry[];
  moduleStates: ModuleStateEntry[];
  /** Sections ajoutées après la v1 du bundle : toujours optionnelles à l'import. */
  platformSettings?: PlatformSettingsEntry[];
  findingIgnores?: FindingIgnoreEntry[];
  workflowGroups?: WorkflowGroupEntry[];
  workflowLinks?: WorkflowLinkEntry[];
}

export type ImportStrategy = 'merge' | 'skip-existing';

export interface SectionReport {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportReport {
  dryRun: boolean;
  strategy: ImportStrategy;
  sections: Record<string, SectionReport>;
  warnings: string[];
}
