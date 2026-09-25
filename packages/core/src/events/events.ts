import { PlatformId } from '../ports/workflow-platform.port';

/** Catalogue des événements inter-modules. */
export const EVENTS = {
  workflowSynced: 'workflow.synced',
  instanceSynced: 'instance.synced',
  workflowUpdated: 'workflow.updated',
  versionCreated: 'version.created',
  verificationCompleted: 'verification.completed',
  jsCheckCompleted: 'jscheck.completed',
  fieldCheckCompleted: 'fieldcheck.completed',
  testCompleted: 'test.completed',
  envSwitched: 'env.switched',
  organizerApplied: 'organizer.applied',
  docGenerated: 'doc.generated',
  depGraphRebuilt: 'depgraph.rebuilt',
  optimizerApplied: 'optimizer.applied',
  monitorBeat: 'monitor.beat',
  monitorErrorsDetected: 'monitor.errorsDetected',
  monitorRelayBroken: 'monitor.relayBroken',
  monitorRelayRestored: 'monitor.relayRestored',
  errorGroupOpened: 'errorGroup.opened',
  errorGroupRegressed: 'errorGroup.regressed',
  errorGroupRecurred: 'errorGroup.recurred',
  perfDriftDetected: 'perf.driftDetected',
  aiCostBudgetExceeded: 'aiCost.budgetExceeded',
  modelLifecycleChanged: 'modelAudit.lifecycleChanged',
  moduleEnabled: 'module.enabled',
  moduleDisabled: 'module.disabled',
  configImported: 'config.imported',
  assistantCorrectionAnswered: 'assistant.correctionAnswered',
  assistantDraftRepaired: 'assistant.draftRepaired',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface WorkflowSyncedEvent {
  workflowId: string; // id DB local
  instanceId: string;
  externalId: string;
  name: string;
  hash: string;
  hashChanged: boolean;
  /** La plateforme qui sert ce workflow : elle dit avec quel code lire `raw`. */
  platform: PlatformId;
  /**
   * Le contenu tel que la plateforme le rend — JSON n8n ou blueprint Make.
   * Volontairement `unknown` : un abonné qui veut le LIRE doit d'abord regarder
   * `platform`, plutôt que de supposer du n8n et de casser au premier scénario.
   */
  raw: unknown;
}

/**
 * Une passe de synchronisation vient de se terminer. Sert aux traitements qui
 * raisonnent sur l'ENSEMBLE des workflows d'une instance plutôt que sur un
 * workflow à la fois — un workflow supprimé de n8n n'émet aucun
 * `workflow.synced`, il ne se voit qu'en comparant la liste au miroir local.
 */
export interface InstanceSyncedEvent {
  instanceId: string;
  /** `workflow` : resynchro d'un seul workflow de cette instance. */
  scope: 'instance' | 'workflow';
}

export interface VersionCreatedEvent {
  versionId: string;
  workflowId: string;
  instanceId: string;
  workflowName: string;
  hash: string;
}

export interface VerificationCompletedEvent {
  workflowId: string;
  findingsCount: number;
  errors: number;
  warnings: number;
}

export interface FieldCheckCompletedEvent {
  workflowId: string;
  findingsCount: number;
  /** Exécutions réellement échantillonnées (0 = rien à comparer). */
  sampledExecutions: number;
}

export interface TestCompletedEvent {
  testRunId: string;
  workflowId: string;
  status: string;
}

export interface EnvSwitchedEvent {
  workflowId: string;
  targetEnv: string;
  replacements: number;
}

export interface ModuleToggledEvent {
  moduleId: string;
  enabled: boolean;
}

export interface MonitorBeatEvent {
  monitorId: string;
  status: 'up' | 'down';
}

export interface MonitorErroredExecution {
  id: string;
  startedAt?: string;
  stoppedAt?: string;
  mode?: string;
}

export interface MonitorErrorsDetectedEvent {
  monitorId: string;
  instanceId: string;
  count: number;
  workflows: Array<{ externalId: string; name: string; executions: MonitorErroredExecution[] }>;
}

/**
 * Un problème vient d'apparaître (nouveau groupe d'erreurs) ou de revenir
 * (rechute après résolution). `occurredAt` est la date de l'occurrence réelle,
 * pas celle du traitement : un backfill d'historique émet des événements
 * anciens, que les abonnés doivent pouvoir écarter.
 */
export interface ErrorGroupNotableEvent {
  groupId: string;
  instanceId: string;
  workflowName: string;
  failedNode: string | null;
  pattern: string;
  category: string;
  occurredAt: string; // ISO
  /** Rechutes cumulées — 0 pour un problème tout neuf. */
  regressions: number;
  /** Occurrences connues du groupe au moment de l'événement. */
  occurrences: number;
}

/** Un workflow vient d'entrer en dérive de durée (médiane ×ratio vs la période précédente). */
/**
 * Le relais vers le monitoring externe ne répond plus : la sonde ne peut plus tomber DOWN,
 * donc l'arrêt du poll qu'elle couvre deviendrait invisible.
 */
export interface MonitorRelayEvent {
  monitorId: string;
  monitorName: string;
  /** Dernière erreur de push (absente au rétablissement). */
  reason?: string;
  /** Échecs consécutifs au moment du basculement. */
  failures: number;
  occurredAt: string; // ISO
}

export interface PerfDriftDetectedEvent {
  instanceId: string;
  externalWorkflowId: string;
  workflowId: string | null;
  workflowName: string;
  /** médiane récente / médiane de référence (≥ 2 par construction). */
  ratio: number;
  p50Ms: number | null;
  /** Taille de la fenêtre comparée, en jours. */
  days: number;
  occurredAt: string; // ISO
}

/**
 * Le coût LLM du jour vient de dépasser le budget quotidien. Une seule émission
 * par jour : le compteur continue de monter mais l'alerte ne se répète pas.
 */
export interface AiCostBudgetExceededEvent {
  /** Jour concerné (YYYY-MM-DD, UTC — même bucket que les courbes). */
  date: string;
  costUsd: number;
  budgetUsd: number;
  /** Les plus gros contributeurs du jour, pour un message actionnable. */
  topWorkflows: Array<{ name: string; costUsd: number }>;
  occurredAt: string; // ISO
}

/**
 * Un modèle PRÉSENT DANS LE PARC vient de changer de statut, à l'application
 * d'une mise à jour du catalogue. Une alerte par transition de modèle et non par
 * workflow : quarante nœuds touchés font quarante fois la même nouvelle.
 */
export interface ModelLifecycleChangedEvent {
  pattern: string;
  provider: string;
  from: string;
  to: string;
  retiresAt: string | null;
  replacedByPattern: string | null;
  /** Ce que ça touche, de quoi écrire un message actionnable sans rien recalculer. */
  workflows: Array<{ name: string; env: string | null; nodeName: string }>;
  occurredAt: string; // ISO
}

export interface ConfigImportedEvent {
  created: number;
  updated: number;
  skipped: number;
  sections: string[];
}

/**
 * L'humain a répondu à la question qu'on lui devait sur une correction faite à la
 * main. C'est la réponse la plus fiable du dispositif : quelqu'un vient de dire
 * si l'assistant s'était trompé ou s'il avait seulement changé d'avis.
 *
 * Événement et non appel direct : `workflow-chat` recueille la réponse, mais la
 * règle qu'on en tire appartient à `assistant-learning`, et un module métier n'en
 * importe jamais un autre.
 */
export interface AssistantCorrectionAnsweredEvent {
  correctionId: string;
  workflowId: string;
  answer: string;
  /** Email de l'humain, quand la requête le porte. */
  author?: string | null;
}

/**
 * La porte a refusé un brouillon de l'assistant, qui l'a corrigé et est passé.
 *
 * Signal à preuve DÉTERMINISTE — rouge puis vert, sans qu'aucun modèle n'ait eu
 * son mot à dire sur le verdict. Il vaut d'être appris parce qu'il est
 * transposable : la même faute sur le même type de nœud se rejouera dans un autre
 * workflow, et une règle servie d'entrée épargne la passe de correction entière.
 *
 * Émis seulement quand la correction a RÉUSSI : un brouillon resté refusé
 * n'apprend rien — on ne sait pas ce qu'il aurait fallu écrire.
 */
export interface AssistantDraftRepairedEvent {
  workflowId: string;
  /** Ce que la porte reprochait au PREMIER brouillon. */
  findings: Array<{
    code: string;
    severity: string;
    nodeName?: string;
    /** Type n8n du nœud visé, résolu sur le candidat : c'est lui qui indexe la leçon. */
    nodeType?: string;
    message: string;
  }>;
  /** Les opérations refusées, puis celles qui sont passées. Bornées en taille. */
  refused: string;
  accepted: string;
}
