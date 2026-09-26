'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { runWithConcurrency } from '../../../lib/concurrency';
import { applyRow, fetchPlan, fetchPreview } from './bulk-env-requests';
import { isApplicable } from './row-status';
import { BulkEnvAction, BulkSettings, PlannedRow, ReviewRow, RowChoices } from './types';

/** Les aperçus ne font que lire : quatre de front, comme la barre d'actions groupées. */
const PREVIEW_CONCURRENCY = 4;

const NO_CHOICES: RowChoices = { validated: false, force: false, confirmSkip: false };

/**
 * L'état d'un lot : plan, aperçus, décisions, résultats. Les écritures partent
 * UNE PAR UNE et dans l'ordre : deux familles qui appellent le même sous-workflow
 * manquant le créeraient chacune en cascade si elles partaient ensemble, alors
 * qu'en série la seconde le trouve sur la cible sous son nom et le réutilise.
 */
export function useBulkEnv(action: BulkEnvAction) {
  const t = useTranslations('workflowsList.bulkEnv.requests');
  const [rows, setRows] = React.useState<ReviewRow[]>([]);
  const [phase, setPhase] = React.useState<'setup' | 'planning' | 'review' | 'applying'>('setup');
  const [error, setError] = React.useState<string | null>(null);
  const settingsRef = React.useRef<BulkSettings | null>(null);

  const patch = React.useCallback((familyKey: string, change: (row: ReviewRow) => ReviewRow) => {
    setRows((current) => current.map((row) => (row.plan.familyKey === familyKey ? change(row) : row)));
  }, []);

  const prepare = async (familyKeys: string[], settings: BulkSettings) => {
    settingsRef.current = settings;
    setError(null);
    setPhase('planning');
    try {
      const plan = await fetchPlan(action, familyKeys, settings);
      setRows(plan.map((row) => ({ plan: row, choices: NO_CHOICES, outcome: { state: 'pending' } })));
      setPhase('review');
      const planned = plan.filter((row): row is PlannedRow => row.status === 'planned');
      await runWithConcurrency(planned, PREVIEW_CONCURRENCY, async (row) => {
        try {
          const preview = await fetchPreview(action, row, settings, t);
          patch(row.familyKey, (current) => ({ ...current, preview, previewError: undefined }));
        } catch (cause) {
          patch(row.familyKey, (current) => ({ ...current, previewError: (cause as Error).message }));
        }
      });
    } catch (cause) {
      setError((cause as Error).message);
      setPhase('setup');
    }
  };

  /** Rejoue l'aperçu d'une ligne : une décision prise sur un aperçu périmé ne vaut rien. */
  const refreshPreview = async (row: ReviewRow) => {
    const settings = settingsRef.current;
    if (!settings || row.plan.status !== 'planned') return;
    const plan = row.plan;
    patch(plan.familyKey, (current) => ({
      ...current,
      preview: undefined,
      previewError: undefined,
      choices: NO_CHOICES,
    }));
    try {
      const preview = await fetchPreview(action, plan, settings, t);
      patch(plan.familyKey, (current) => ({ ...current, preview }));
    } catch (cause) {
      patch(plan.familyKey, (current) => ({ ...current, previewError: (cause as Error).message }));
    }
  };

  const setChoices = (familyKey: string, choices: Partial<RowChoices>) =>
    patch(familyKey, (row) => ({ ...row, choices: { ...row.choices, ...choices } }));

  const apply = async (targets: ReviewRow[]) => {
    const settings = settingsRef.current;
    if (!settings) return;
    setPhase('applying');
    try {
      for (const row of targets.filter(isApplicable)) {
        patch(row.plan.familyKey, (current) => ({ ...current, outcome: { state: 'running' } }));
        try {
          const result = await applyRow(action, row, settings, t);
          patch(row.plan.familyKey, (current) => ({ ...current, outcome: { state: 'done', ...result } }));
        } catch (cause) {
          patch(row.plan.familyKey, (current) => ({
            ...current,
            outcome: { state: 'failed', error: (cause as Error).message },
          }));
        }
      }
    } finally {
      setPhase('review');
    }
  };

  const reset = () => {
    setRows([]);
    setError(null);
    setPhase('setup');
  };

  return { rows, phase, error, prepare, refreshPreview, setChoices, apply, reset };
}
