import { replayEnv, replayTargetEnv } from './replay';
import type { EnvHop, MacroAction, StepRun } from './types';

/**
 * Édition d'une procédure dans la console, y compris en plein rejeu. Le rejeu vit ici
 * (état en mémoire du navigateur) : c'est donc ici que se calcule la zone figée qu'on
 * envoie à l'API, et que le curseur suit les étapes par leur id, jamais par leur rang.
 */

const FROZEN = new Set<StepRun['state']>(['done', 'skipped', 'running']);
const PLAYED = new Set<StepRun['state']>(['done', 'skipped']);

type Identified = { id: string };

/** Recopie de `frozenCount` (`@nwm/core`, `release-macro-edit.ts`) : le web ne dépend pas du core. */
export function frozenCount(steps: Identified[], runs: Record<string, StepRun>): number {
  const index = steps.findIndex((step) => !FROZEN.has(runs[step.id]?.state ?? 'todo'));
  return index === -1 ? steps.length : index;
}

/** La prochaine étape du rejeu, relue sur la liste COURANTE : une édition en cours de route est prise en compte. */
export function nextToPlay<T extends Identified>(steps: T[], runs: Record<string, StepRun>): T | null {
  return steps.find((step) => !PLAYED.has(runs[step.id]?.state ?? 'todo')) ?? null;
}

/** Déplace une étape de `delta` rangs ; `null` si elle sortirait de la liste ou franchirait la zone figée. */
export function moveStep(ids: string[], id: string, delta: number, frozen = 0): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < frozen || to < frozen || to >= ids.length || delta === 0) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * L'env à ENREGISTRER pour qu'il se lise `env` au rejeu (un geste posé en plein rejeu se
 * saisit dans les termes du rejeu) ; `null` quand aucun env ne se rejoue ainsi. `action` :
 * l'env visé par ce geste, `null` pour l'env de son exemplaire.
 */
export function unshiftEnv(
  env: string,
  action: MacroAction | null,
  envIds: string[],
  recorded: EnvHop | null,
  replay: EnvHop | null,
): string | null {
  if (!recorded || !replay) return env;
  const shift = (candidate: string) =>
    action ? replayTargetEnv(action, candidate, recorded, replay) : replayEnv(candidate, recorded, replay);
  // Plusieurs envs peuvent se rejouer pareil (PREPROD et PROD enregistrés se lisent tous deux PROD) :
  // ceux du saut enregistré d'abord, pour que l'étape glisse avec les autres au prochain décalage.
  const candidates = [recorded.source, recorded.target, env, ...envIds];
  return candidates.find((candidate) => shift(candidate) === env) ?? null;
}
