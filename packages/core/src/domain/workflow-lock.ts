/**
 * Verrou d'un exemplaire de workflow : tant qu'il est posé, aucune écriture de la
 * plateforme ne le modifie, sauf forçage NOMMÉ et JUSTIFIÉ.
 *
 * Le forçage voyage dans deux en-têtes plutôt que dans le corps de chaque route :
 * une vingtaine de gestes écrivent (promotion, IA, restauration, renommage…), et
 * c'est la console qui rejoue l'appel refusé une fois la modale confirmée — elle
 * ne connaît pas la forme du corps de chaque route. Il nomme les workflows qu'il
 * lève : un appel qui touche plusieurs exemplaires (promotion en cascade, lot) ne
 * lève jamais un verrou que personne n'a vu.
 */

export const LOCK_OVERRIDE_IDS_HEADER = 'x-lock-override';
export const LOCK_OVERRIDE_REASON_HEADER = 'x-lock-override-reason';
/** `code` du corps d'un refus (HTTP 423), que la console reconnaît pour ouvrir la modale. */
export const WORKFLOW_LOCKED_CODE = 'workflow-locked';

const REASON_MIN = 5;
const REASON_MAX = 500;

export interface LockedWorkflow {
  id: string;
  name: string;
  lockedBy?: string | null;
}

export interface LockOverride {
  workflowIds: string[];
  reason: string;
}

export interface LockVerdict {
  /** Verrouillés et non levés : l'écriture doit être refusée. */
  blocking: LockedWorkflow[];
  /** Verrouillés mais levés par le forçage : l'écriture passe, et se journalise. */
  overridden: LockedWorkflow[];
}

export function lockReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) return `Raison obligatoire (${REASON_MIN} caractères au moins).`;
  if (trimmed.length > REASON_MAX) return `Raison trop longue (${REASON_MAX} caractères au plus).`;
  return null;
}

/** Les en-têtes n'admettent que de l'ASCII : la raison part encodée. */
export function encodeLockOverride(workflowIds: string[], reason: string): { ids: string; reason: string } {
  return { ids: workflowIds.join(','), reason: encodeURIComponent(reason.trim()) };
}

function decodeReason(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function parseLockOverride(ids?: string, reason?: string): LockOverride | null {
  const workflowIds = [
    ...new Set(
      (ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (workflowIds.length === 0 || reason === undefined) return null;
  const decoded = decodeReason(reason).trim();
  if (lockReasonError(decoded)) return null;
  return { workflowIds, reason: decoded };
}

export function lockVerdict(locked: LockedWorkflow[], override: LockOverride | null): LockVerdict {
  const lifted = new Set(override?.workflowIds ?? []);
  return {
    blocking: locked.filter((workflow) => !lifted.has(workflow.id)),
    overridden: locked.filter((workflow) => lifted.has(workflow.id)),
  };
}

export function lockRefusalMessage(blocking: LockedWorkflow[]): string {
  const names = blocking.map((workflow) => `« ${workflow.name} »`).join(', ');
  return blocking.length > 1
    ? `${names} sont verrouillés : forcer demande une raison.`
    : `${names} est verrouillé : forcer demande une raison.`;
}
