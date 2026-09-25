/**
 * Le verrou vu de la console : lire le refus (423) de l'API, et rejouer l'appel
 * avec un forçage qui NOMME les workflows et dit pourquoi. Recopie de
 * `workflow-lock.ts` du domaine, la console ne dépendant pas de `@nwm/core`.
 */

export interface LockedWorkflow {
  id: string;
  name: string;
  lockedBy?: string | null;
}

const REASON_MIN = 5;
const REASON_MAX = 500;

export function lockReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) return `${REASON_MIN} caractères au moins`;
  if (trimmed.length > REASON_MAX) return `${REASON_MAX} caractères au plus`;
  return null;
}

/** Les exemplaires qui ont refusé l'écriture, ou null si ce n'est pas un refus de verrou. */
export function lockedFromRefusal(status: number, text: string): LockedWorkflow[] | null {
  if (status !== 423) return null;
  try {
    const body = JSON.parse(text) as { code?: string; locked?: LockedWorkflow[] };
    return body.code === 'workflow-locked' && Array.isArray(body.locked) ? body.locked : null;
  } catch {
    return null;
  }
}

/** Les en-têtes n'admettent que de l'ASCII : la raison part encodée. */
export function overrideHeaders(workflowIds: string[], reason: string): Record<string, string> {
  return {
    'x-lock-override': workflowIds.join(','),
    'x-lock-override-reason': encodeURIComponent(reason.trim()),
  };
}
