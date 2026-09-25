import { ReviewRow } from './types';

/** Où en est une ligne de la revue, du point de vue de l'humain qui la regarde. */
export type RowStatus = 'skipped' | 'loading' | 'error' | 'blocked' | 'decide' | 'ready';

export const STATUS_TAG: Record<RowStatus, { color: string; label: string }> = {
  ready: { color: 'green', label: 'prête' },
  decide: { color: 'orange', label: 'à décider' },
  blocked: { color: 'red', label: 'bloquée' },
  skipped: { color: 'default', label: 'ignorée' },
  error: { color: 'volcano', label: 'aperçu en échec' },
  loading: { color: 'processing', label: 'aperçu…' },
};

/** Une ligne « à décider » validée par l'humain devient prête : elle part avec les autres. */
export function rowStatus(row: ReviewRow): RowStatus {
  if (row.plan.status === 'skipped') return 'skipped';
  if (row.previewError) return 'error';
  if (!row.preview) return 'loading';
  const { readiness } = row.preview.data;
  if (readiness.status === 'blocked') return 'blocked';
  if (readiness.status === 'decide' && !row.choices.validated) return 'decide';
  return 'ready';
}

/** Les cases qu'une décision exige avant de pouvoir la valider — les autres ne demandent qu'un regard. */
export function missingChecks(row: ReviewRow): string[] {
  const codes = row.preview?.data.readiness.decisions.map((decision) => decision.code) ?? [];
  const missing: string[] = [];
  if (codes.includes('force') && !row.choices.force) missing.push('forcer les gates au rouge');
  if (codes.includes('confirm-skip') && !row.choices.confirmSkip) missing.push('confirmer le saut d’étape');
  return missing;
}

/** Prête et pas encore passée (ou passée en échec, qu'on peut rejouer). */
export function isApplicable(row: ReviewRow): boolean {
  return rowStatus(row) === 'ready' && (row.outcome.state === 'pending' || row.outcome.state === 'failed');
}
