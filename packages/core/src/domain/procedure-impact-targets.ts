import { EnvHop, MacroAction, replayEnv, replayTargetEnv } from './release-macro';

/**
 * Ce qu'une procédure va TOUCHER si on la rejoue sur un saut : pour chaque geste,
 * l'exemplaire (workflow métier, env) qu'il écrit ou fait tourner, envs décalés
 * comme au rejeu. C'est la liste que l'étude d'impact va lire — avant le premier clic.
 */

export interface ProcedureTargetStep {
  id: string;
  kind: 'auto' | 'manual';
  action: MacroAction | null;
  familyKey: string | null;
  familyName: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
}

/** `write` : l'exemplaire est écrit ou créé ; `run` : il tourne pour de vrai (tests) ; `read` : seulement lu. */
export type ProcedureTargetRole = 'write' | 'run' | 'read';

export interface ProcedureImpactTarget {
  familyKey: string;
  familyName: string;
  env: string;
  role: ProcedureTargetRole;
  /** Les étapes qui y mènent, pour que l'écran dise « étapes 2 et 5 ». */
  stepIds: string[];
}

const ROLE_RANK: Record<ProcedureTargetRole, number> = { read: 0, run: 1, write: 2 };

/** Un geste engage son exemplaire de départ (lu, testé, déclaré, rebranché) et, pour une copie, celui d'arrivée (écrit). */
function touches(step: ProcedureTargetStep, shift: (env: string | null, target?: boolean) => string | null) {
  const out: Array<{ env: string | null; role: ProcedureTargetRole }> = [];
  switch (step.action) {
    case 'promote':
    case 'duplicate':
      out.push(
        { env: shift(step.sourceEnv), role: 'read' },
        { env: shift(step.targetEnv, true), role: 'write' },
      );
      break;
    case 'mark':
    case 'switch':
    case 'publish':
      out.push({ env: shift(step.sourceEnv), role: 'write' });
      break;
    case 'run-tests':
      out.push({ env: shift(step.sourceEnv), role: 'run' });
      break;
    default:
      break;
  }
  return out;
}

export function procedureImpactTargets(
  steps: readonly ProcedureTargetStep[],
  recorded: EnvHop | null,
  replay: EnvHop | null,
): ProcedureImpactTarget[] {
  const targets = new Map<string, ProcedureImpactTarget>();
  for (const step of steps) {
    if (step.kind !== 'auto' || !step.action || !step.familyKey) continue;
    const action = step.action;
    const shift = (env: string | null, target = false): string | null => {
      if (!recorded || !replay) return env;
      return target ? replayTargetEnv(action, env, recorded, replay) : replayEnv(env, recorded, replay);
    };
    for (const touch of touches(step, shift)) {
      if (!touch.env) continue;
      const key = `${step.familyKey}@${touch.env}`;
      const existing = targets.get(key);
      if (!existing) {
        targets.set(key, {
          familyKey: step.familyKey,
          familyName: step.familyName ?? step.familyKey,
          env: touch.env,
          role: touch.role,
          stepIds: [step.id],
        });
        continue;
      }
      if (ROLE_RANK[touch.role] > ROLE_RANK[existing.role]) existing.role = touch.role;
      if (!existing.stepIds.includes(step.id)) existing.stepIds.push(step.id);
    }
  }
  return [...targets.values()];
}
