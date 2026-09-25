/** Les formes servies par `/release-procedures` (module API `release-procedures`). */

export type MacroAction = 'promote' | 'mark' | 'duplicate' | 'switch' | 'run-tests' | 'publish';

/** Les gestes qui visent leur exemplaire et non un autre env. */
export const TARGETLESS: ReadonlySet<MacroAction> = new Set(['run-tests', 'publish']);

export interface ProcedureStep {
  id: string;
  position: number;
  kind: 'auto' | 'manual';
  action: MacroAction | null;
  familyKey: string | null;
  familyName: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean> | null;
  label: string;
  /** Consigne libre posée sur l'étape, montrée au rejeu sans rien bloquer. */
  note: string | null;
}

/** Un geste rejouable posé à la main (`POST /release-procedures/:id/steps/gesture`), envs de l'enregistrement. */
export interface GestureDraft {
  action: MacroAction;
  familyKey: string;
  familyName: string;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean>;
  note?: string | null;
}

export interface Procedure {
  id: string;
  name: string;
  status: 'recording' | 'ready';
  sourceEnv: string | null;
  targetEnv: string | null;
  steps: ProcedureStep[];
  updatedAt: string;
}

export interface EnvHop {
  source: string;
  target: string;
}

/** Où en est une étape pendant un rejeu. `waiting` = un humain doit trancher ou valider. */
export type StepRun =
  | { state: 'todo' }
  | { state: 'running' }
  | { state: 'waiting'; decisions?: string[]; resume?: () => Promise<string> }
  /** `redo` : le geste était déjà en place, on peut le rejouer quand même. */
  | { state: 'done'; summary?: string; redo?: () => Promise<StepRun> }
  | { state: 'failed'; error: string }
  | { state: 'skipped' };
