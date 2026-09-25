import type { SwitchedResource } from '../../../components/switched-resources';
import type { WorkflowDiff } from '../../../components/workflow-diff-view';
import type { PromoteChainGate } from '../show/[id]/promote-chain-card';
import type { PromoteVersionGate, ReleaseLevel } from '../show/[id]/promote-version-card';

/** Les gestes d'environnement qu'un lot sait jouer. */
export type BulkEnvAction = 'promote' | 'duplicate' | 'mark';

/** Ligne du plan servi par `POST /env-switcher/bulk/plan`. */
export type BulkPlanRow =
  | {
      familyKey: string;
      familyName: string;
      status: 'planned';
      sourceId: string;
      sourceName: string;
      sourceInstanceId: string;
      targetEnv: string;
      targetInstanceId: string;
      targetExemplarId?: string;
    }
  | {
      familyKey: string;
      familyName: string;
      status: 'skipped';
      /** `already-done` : le geste a déjà eu lieu, `exemplarId` en porte le résultat. */
      code: 'already-done' | 'missing' | 'ambiguous' | 'conflict';
      reason: string;
      exemplarId?: string;
    };

export type PlannedRow = Extract<BulkPlanRow, { status: 'planned' }>;

/** Ce qu'il reste à un humain, calculé par l'API (`env-action-readiness.ts`). */
export interface Readiness {
  status: 'ready' | 'decide' | 'blocked';
  decisions: Array<{
    code: 'diff' | 'target-active' | 'force' | 'confirm-skip' | 'unmapped' | 'locked';
    label: string;
    details?: string[];
  }>;
  reasons: string[];
}

/** Sous-ensemble de la preview de promotion que la revue de lot affiche. */
export interface PromotePreview {
  targetName: string;
  targetInstanceName: string;
  mode: 'create' | 'update';
  targetActive?: boolean;
  blockers: string[];
  forceable: boolean;
  diff?: WorkflowDiff;
  cascade: Array<{ workflowId: string; sourceName: string; targetName: string }>;
  gates: { version: PromoteVersionGate; chain: PromoteChainGate };
  readiness: Readiness;
}

export interface DuplicatePreview {
  sourceName: string;
  targetName: string;
  replacements: number;
  switched?: SwitchedResource[];
  unmapped: Array<{ key: string; provider: string; label?: string; nodes: string[] }>;
  readiness: Readiness;
}

/** Aperçu avant/après d'une déclaration d'env : rien n'est lu dans n8n, tout se déduit. */
export interface MarkPreview {
  sourceName: string;
  /** Ce que la déclaration posera, dit avant d'appliquer. */
  changes: string[];
  readiness: Readiness;
}

export type BulkPreview =
  | { kind: 'promote'; data: PromotePreview }
  | { kind: 'duplicate'; data: DuplicatePreview }
  | { kind: 'mark'; data: MarkPreview };

/** Ce que l'humain a tranché pour une ligne « à décider ». */
export interface RowChoices {
  /** Les décisions de la ligne sont prises : elle part avec les prêtes. */
  validated: boolean;
  force: boolean;
  confirmSkip: boolean;
  /** Absent : la proposition de la preview s'applique. */
  bump?: ReleaseLevel;
}

export type RowOutcome =
  | { state: 'pending' }
  | { state: 'running' }
  | { state: 'done'; summary: string; detail?: string; warning?: string }
  | { state: 'failed'; error: string };

/** Une ligne de la revue : le plan, sa preview, ce qu'on en a décidé et comment ça s'est fini. */
export interface ReviewRow {
  plan: BulkPlanRow;
  preview?: BulkPreview;
  previewError?: string;
  choices: RowChoices;
  outcome: RowOutcome;
}

/** Réglages valables pour tout le lot. */
export interface BulkSettings {
  sourceEnv: string | null;
  targetEnv: string;
  /** Instance d'arrivée quand l'env cible n'existe pas encore dans une famille. */
  fallbackInstanceId?: string;
  /** Promotion : passer par les envs intermédiaires plutôt que de les sauter. */
  throughChain: boolean;
  cascade: boolean;
  checkRemote: boolean;
  /** Promotion : publier sur la cible ce qui est publié dans la source, appelés d'abord. */
  publishLikeSource: boolean;
  /** Déclaration : suffixer aussi le nom. */
  rename: boolean;
}
