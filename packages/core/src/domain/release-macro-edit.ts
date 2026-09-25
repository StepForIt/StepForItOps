import { gestureOptions, MACRO_GESTURES, MacroAction, stepLabel } from './release-macro';

/**
 * Édition d'une procédure après coup : réordonner, insérer, poser un geste à la main.
 * L'édition reste ouverte pendant un rejeu, d'où la zone FIGÉE : les étapes déjà jouées
 * (ou en train de l'être) ne bougent plus, et rien ne s'insère avant elles — sinon une
 * étape glissée derrière le curseur ne serait jamais jouée.
 */

/** Où en est une étape au rejeu (même vocabulaire que la console). */
export type ReplayState = 'todo' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped';

const FROZEN: ReadonlySet<ReplayState> = new Set(['done', 'skipped', 'running']);

/** Nombre d'étapes figées en tête : jouées, passées ou en cours. Celle qui attend un humain reste éditable. */
export function frozenCount(states: ReplayState[]): number {
  const index = states.findIndex((state) => !FROZEN.has(state));
  return index === -1 ? states.length : index;
}

export type ReorderResult = { ok: true; order: string[] } | { ok: false; reason: string };

/** Valide un nouvel ordre : exactement les mêmes étapes, et les `frozen` premières à leur place. */
export function reorderSteps(current: string[], order: string[], frozen = 0): ReorderResult {
  const known = new Set(current);
  if (
    order.length !== current.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !known.has(id))
  ) {
    return { ok: false, reason: "L'ordre doit reprendre exactement les étapes de la procédure" };
  }
  for (let index = 0; index < frozen; index++) {
    if (order[index] !== current[index])
      return { ok: false, reason: 'Les étapes déjà jouées ne bougent plus' };
  }
  return { ok: true, order };
}

/** Où insérer une étape : à la fin sans position, jamais avant une étape figée. */
export function insertPosition(requested: number | undefined, length: number, frozen = 0): number {
  const wanted = typeof requested === 'number' && Number.isFinite(requested) ? Math.trunc(requested) : length;
  return Math.max(frozen, 0, Math.min(wanted, length));
}

export interface GestureInput {
  action: string;
  familyKey: string;
  familyName: string;
  sourceEnv?: string | null;
  targetEnv?: string | null;
  options?: Record<string, unknown> | null;
}

/** Une étape automatique, de la forme exacte de celle que produit la capture. */
export interface GestureStep {
  kind: 'auto';
  action: MacroAction;
  familyKey: string;
  familyName: string;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean>;
  label: string;
}

export type GestureResult = { ok: true; step: GestureStep } | { ok: false; reason: string };

const refuse = (reason: string): GestureResult => ({ ok: false, reason });

/**
 * Un geste rejouable saisi à la main. L'env de départ est exigé dès que le rejeu le lit
 * (promotion, duplication : l'exemplaire source ; tests, publication : l'exemplaire visé), facultatif
 * pour une déclaration, qui vise un workflow quel que soit son env.
 */
export function manualGesture(input: GestureInput, envIds: string[]): GestureResult {
  const action = input.action as MacroAction;
  if (!Object.prototype.hasOwnProperty.call(MACRO_GESTURES, action)) return refuse('Geste inconnu');
  const familyKey = input.familyKey?.trim();
  const familyName = input.familyName?.trim();
  if (!familyKey || !familyName) return refuse('Choisis un workflow');

  const sourceEnv = input.sourceEnv || null;
  const targetEnv = MACRO_GESTURES[action].needsEnv ? input.targetEnv || null : null;
  const undeclared = [sourceEnv, targetEnv].find((env) => env && !envIds.includes(env));
  if (undeclared) return refuse(`Env ${undeclared.toUpperCase()} non déclaré`);
  if (MACRO_GESTURES[action].needsEnv && !targetEnv) return refuse('Choisis un env cible');
  if (action !== 'mark' && !sourceEnv) return refuse('Choisis un env de départ');
  // Rebrancher un exemplaire sur les données de son propre env est le cas courant (la copie qu'on vient de faire).
  if (action !== 'mark' && action !== 'switch' && sourceEnv === targetEnv) {
    return refuse('Choisis deux envs différents');
  }

  return {
    ok: true,
    step: {
      kind: 'auto',
      action,
      familyKey,
      familyName,
      sourceEnv,
      targetEnv,
      options: gestureOptions(action, input.options ?? {}),
      label: stepLabel({ action, familyName, targetEnv, sourceEnv }),
    },
  };
}

/**
 * L'étape qui dit le saut d'une procédure : la première promotion ou duplication, dans l'ordre.
 * Déclarer ou rebrancher laissent le workflow sur place et ne disent donc aucun saut.
 */
export function hopStep<
  T extends { action: string | null; sourceEnv: string | null; targetEnv: string | null },
>(steps: T[]): T | null {
  return (
    steps.find(
      (step) =>
        (step.action === 'promote' || step.action === 'duplicate') && step.sourceEnv && step.targetEnv,
    ) ?? null
  );
}
