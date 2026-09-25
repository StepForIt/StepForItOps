import { EnvHop, MacroAction, replayEnv, replayTargetEnv, stepLabel } from './release-macro';

/**
 * Copie d'une procédure vers un autre saut : l'enregistrement dev → preprod devient une
 * procédure « mise en prod » preprod → prod, qui se rejoue et s'édite seule. Les envs
 * glissent par les MÊMES règles que le rejeu, si bien que la copie rejouée sur son saut
 * fait exactement ce que ferait l'originale rejouée un cran plus loin.
 */

export interface RebasableStep {
  kind: 'auto' | 'manual';
  action: MacroAction | null;
  familyKey: string | null;
  familyName: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean> | null;
  label: string;
  /** Consigne libre de l'humain, recopiée telle quelle. */
  note: string | null;
}

/** Les étapes décalées, dans leur ordre ; une étape manuelle est recopiée telle quelle. */
export function rebaseSteps(steps: RebasableStep[], recorded: EnvHop, to: EnvHop): RebasableStep[] {
  return steps.map((step) => {
    if (step.kind === 'manual' || !step.action) return { ...step };
    const targetEnv = replayTargetEnv(step.action, step.targetEnv, recorded, to);
    const sourceEnv = replayEnv(step.sourceEnv, recorded, to);
    return {
      ...step,
      sourceEnv,
      targetEnv,
      label: step.familyName
        ? stepLabel({ action: step.action, familyName: step.familyName, targetEnv, sourceEnv })
        : step.label,
    };
  });
}
