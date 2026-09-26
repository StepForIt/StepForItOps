import { msg } from '../i18n';
import { EnvDefinition } from './env';

/**
 * Procédure de mise en ligne enregistrée comme une macro : pendant l'enregistrement,
 * chaque geste d'environnement réussi dans la console devient une étape ; au rejeu,
 * les envs sont décalés (dev → preprod enregistré, preprod → prod rejoué).
 */

export type MacroAction = 'promote' | 'mark' | 'duplicate' | 'switch' | 'run-tests' | 'publish';

export interface CapturedGesture {
  action: MacroAction;
  workflowId: string;
  /** Env visé par le geste ; `null` pour un geste qui n'en change pas (tests, publication). */
  targetEnv: string | null;
  /** Réglages rejouables seulement : une décision humaine (`force`, `bump`) se reprend au rejeu. */
  options: Record<string, boolean>;
}

/**
 * Ce que chaque geste emporte : les seuls réglages rejouables, et s'il vise un env.
 * Partagé par la capture et la saisie à la main, pour qu'une étape ait la même forme d'où qu'elle vienne.
 */
export const MACRO_GESTURES: Record<MacroAction, { options: string[]; needsEnv: boolean }> = {
  promote: { options: ['cascade', 'throughChain', 'checkRemote', 'publishLikeSource'], needsEnv: true },
  mark: { options: ['rename'], needsEnv: true },
  duplicate: { options: ['cascade'], needsEnv: true },
  switch: { options: [], needsEnv: true },
  'run-tests': { options: [], needsEnv: false },
  publish: { options: [], needsEnv: false },
};

const ROUTES: Array<{ action: MacroAction; pattern: RegExp }> = [
  { action: 'promote', pattern: /^\/env-switcher\/promote\/([^/]+)$/ },
  { action: 'mark', pattern: /^\/env-switcher\/mark\/([^/]+)$/ },
  { action: 'duplicate', pattern: /^\/env-switcher\/duplicate\/([^/]+)$/ },
  { action: 'switch', pattern: /^\/env-switcher\/apply\/([^/]+)$/ },
  { action: 'run-tests', pattern: /^\/tester\/cases\/run-all\/([^/]+)$/ },
  { action: 'publish', pattern: /^\/workflows\/([^/]+)\/publish$/ },
];

/** Les réglages rejouables d'un geste ; tout le reste — décisions humaines comprises — est écarté. */
export function gestureOptions(
  action: MacroAction,
  fields: Record<string, unknown>,
): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const key of MACRO_GESTURES[action].options) {
    if (typeof fields[key] === 'boolean') options[key] = fields[key] as boolean;
  }
  return options;
}

/** Reconnaît un geste rejouable dans un appel d'API réussi ; `null` pour tout le reste. */
export function captureGesture(method: string, path: string, body: unknown): CapturedGesture | null {
  if (method.toUpperCase() !== 'POST') return null;
  const bare = path.split('?')[0];
  const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  for (const route of ROUTES) {
    const match = route.pattern.exec(bare);
    if (!match) continue;
    const targetEnv = typeof fields.targetEnv === 'string' ? fields.targetEnv : null;
    if (MACRO_GESTURES[route.action].needsEnv && !targetEnv) return null;
    return {
      action: route.action,
      workflowId: decodeURIComponent(match[1]),
      targetEnv,
      options: gestureOptions(route.action, fields),
    };
  }
  return null;
}

export interface EnvHop {
  source: string;
  target: string;
}

/** L'env d'une étape au rejeu : la source et la cible enregistrées glissent vers celles du rejeu. */
export function replayEnv(env: string | null, recorded: EnvHop, replay: EnvHop): string | null {
  if (env === recorded.source) return replay.source;
  if (env === recorded.target) return replay.target;
  return env;
}

/**
 * L'env visé par un geste au rejeu. Déclarer un workflow sur l'env de DÉPART est une
 * préparation faite avant le saut (le workflow neuf qu'on étiquette `dev`) : on ne le
 * redéclare pas `preprod` au rejeu, on constate qu'il est déjà `dev`.
 */
export function replayTargetEnv(
  action: MacroAction,
  env: string | null,
  recorded: EnvHop,
  replay: EnvHop,
): string | null {
  if (action === 'mark' && env === recorded.source) return env;
  return replayEnv(env, recorded, replay);
}

/** L'étape suivante de la chaîne : le premier env déclaré qui dépend de celui-ci. */
export function nextHop(envs: EnvDefinition[], env: string): string | null {
  return envs.find((candidate) => candidate.after === env && candidate.id !== env)?.id ?? null;
}

/** Une publication vise l'exemplaire lui-même : c'est son env qui se lit (« Publier X en PROD »). */
export function stepLabel(step: {
  action: MacroAction;
  familyName: string;
  targetEnv: string | null;
  sourceEnv?: string | null;
}): string {
  if (step.action === 'publish') {
    return msg('release.stepPublish', {
      name: step.familyName,
      hasEnv: Boolean(step.sourceEnv),
      env: step.sourceEnv?.toUpperCase() ?? '',
    });
  }
  return msg('release.stepGesture', {
    action: step.action,
    name: step.familyName,
    hasTarget: Boolean(step.targetEnv),
    target: step.targetEnv?.toUpperCase() ?? '',
  });
}
