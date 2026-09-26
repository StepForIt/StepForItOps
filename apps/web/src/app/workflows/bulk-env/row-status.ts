import { ReviewRow } from './types';

/** Où en est une ligne de la revue, du point de vue de l'humain qui la regarde. */
export type RowStatus = 'skipped' | 'loading' | 'error' | 'blocked' | 'decide' | 'ready';

/** Couleur du tag de statut ; le libellé se traduit au rendu (`bulkEnv.review.status.<statut>`). */
export const STATUS_COLOR: Record<RowStatus, string> = {
  ready: 'green',
  decide: 'orange',
  blocked: 'red',
  skipped: 'default',
  error: 'volcano',
  loading: 'processing',
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

/** Une case qu'une décision exige ; son libellé se traduit au rendu (`bulkEnv.detail.missing.<case>`). */
export type MissingCheck = 'force' | 'confirmSkip';

/** Les cases qu'une décision exige avant de pouvoir la valider — les autres ne demandent qu'un regard. */
export function missingChecks(row: ReviewRow): MissingCheck[] {
  const codes = row.preview?.data.readiness.decisions.map((decision) => decision.code) ?? [];
  const missing: MissingCheck[] = [];
  if (codes.includes('force') && !row.choices.force) missing.push('force');
  if (codes.includes('confirm-skip') && !row.choices.confirmSkip) missing.push('confirmSkip');
  return missing;
}

/** Prête et pas encore passée (ou passée en échec, qu'on peut rejouer). */
export function isApplicable(row: ReviewRow): boolean {
  return rowStatus(row) === 'ready' && (row.outcome.state === 'pending' || row.outcome.state === 'failed');
}
