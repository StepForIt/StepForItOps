'use client';

import React from 'react';
import { Alert, Button, Popconfirm, Space, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  InboxOutlined,
  ReloadOutlined,
  SafetyOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import { runWithConcurrency } from '../../lib/concurrency';
import { WorkflowRow } from './workflow-row';

/** Workflows traités de front : chaque action est un aller-retour vers n8n. */
const BULK_CONCURRENCY = 4;

type BulkT = ReturnType<typeof useTranslations<'workflowsList.bulkActions'>>;

interface BulkAction {
  key: 'resync' | 'analyse' | 'archive' | 'unarchive';
  label: string;
  icon: React.ReactNode;
  /** Toast de fin quand tout est passé (« 3 workflows archivés »). */
  success: (count: number) => string;
  /** Toast de fin avec échecs (« 3/5 archivés — 2 échecs : … »). */
  partial: (values: { ok: number; total: number; failed: number; first: string }) => string;
  /** Ce que le geste fait, dit avant de le confirmer quand ce n'est pas évident. */
  description?: string;
  /** Ligne sur laquelle l'action a un sens ; les autres sont laissées de côté, pas mises en échec. */
  eligible: (workflow: WorkflowRow) => boolean;
  /** Pourquoi les lignes écartées le sont — affiché avec leur nombre. */
  skipped: string;
  run: (workflow: WorkflowRow) => Promise<unknown>;
}

/**
 * Les 4 analyses d'un workflow, comme la page Couverture. Un module désactivé
 * répond 404 : on n'échoue que si AUCUNE des quatre n'a abouti, sinon une
 * plateforme qui n'active que la vérification structurelle serait toute rouge.
 */
async function analyse(workflow: WorkflowRow, fallbackError: string): Promise<void> {
  const results = await Promise.allSettled([
    apiPost(`/verifier/run/${workflow.id}?ai=1`),
    apiPost(`/js-checker/run/${workflow.id}?ai=1`),
    apiPost(`/optimizer/analyze/${workflow.id}`),
    apiPost(`/field-checker/run/${workflow.id}`),
  ]);
  if (results.some((result) => result.status === 'fulfilled')) return;
  const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  throw new Error((first?.reason as Error)?.message ?? fallbackError);
}

function bulkActions(t: BulkT): BulkAction[] {
  return [
    {
      key: 'resync',
      label: t('resync.label'),
      icon: <ReloadOutlined />,
      success: (count) => t('resync.success', { count }),
      partial: (values) => t('resync.partial', values),
      eligible: () => true,
      skipped: '',
      run: (workflow) => apiPost(`/workflows/${workflow.id}/resync`),
    },
    {
      key: 'analyse',
      label: t('analyse.label'),
      icon: <SafetyOutlined />,
      success: (count) => t('analyse.success', { count }),
      partial: (values) => t('analyse.partial', values),
      description: t('analyse.description'),
      eligible: (workflow) => !workflow.missingInN8n,
      skipped: t('analyse.skipped'),
      run: (workflow) => analyse(workflow, t('analyseFailed')),
    },
    {
      key: 'archive',
      label: t('archive.label'),
      icon: <InboxOutlined />,
      success: (count) => t('archive.success', { count }),
      partial: (values) => t('archive.partial', values),
      description: t('archive.description'),
      eligible: (workflow) => !workflow.archived && !workflow.archivedUpstream && !workflow.missingInN8n,
      skipped: t('archive.skipped'),
      run: (workflow) => apiPost(`/workflows/${workflow.id}/archive`),
    },
    {
      key: 'unarchive',
      label: t('unarchive.label'),
      icon: <UndoOutlined />,
      // Archivé DANS n8n : l'API publique refuse d'y toucher, le retour se fait dans n8n.
      success: (count) => t('unarchive.success', { count }),
      partial: (values) => t('unarchive.partial', values),
      description: t('unarchive.description'),
      eligible: (workflow) => workflow.archived && !workflow.archivedUpstream && !workflow.missingInN8n,
      skipped: t('unarchive.skipped'),
      run: (workflow) => apiPost(`/workflows/${workflow.id}/unarchive`),
    },
  ];
}

/**
 * Barre d'actions groupées de la liste des workflows. Elle ne fait que rejouer,
 * sur chaque ligne cochée, l'appel que porte déjà son bouton de ligne : archiver
 * cinquante workflows un par un se payait en cinquante clics et autant de confirmations.
 * Les lignes sur lesquelles le geste n'a pas de sens sont ANNONCÉES puis ignorées —
 * les mettre en échec ferait passer un lot normal pour un lot cassé.
 */
export function WorkflowBulkActions({
  selected,
  onDone,
  onClear,
}: {
  selected: WorkflowRow[];
  /** Une action est passée : la liste (et les compteurs) se rechargent. */
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('workflowsList.bulkActions');
  const tCommon = useTranslations('common');
  const actions = bulkActions(t);
  const [running, setRunning] = React.useState<{ action: string; done: number; total: number } | null>(null);

  const run = async (action: BulkAction, targets: WorkflowRow[]) => {
    setRunning({ action: action.key, done: 0, total: targets.length });
    const failures: string[] = [];
    try {
      await runWithConcurrency(
        targets,
        BULK_CONCURRENCY,
        async (workflow) => {
          try {
            await action.run(workflow);
          } catch (error) {
            failures.push(`${workflow.name} — ${(error as Error).message}`);
          }
        },
        () => setRunning((current) => (current ? { ...current, done: current.done + 1 } : current)),
      );
      const ok = targets.length - failures.length;
      if (failures.length > 0) {
        message.warning(
          action.partial({ ok, total: targets.length, failed: failures.length, first: failures[0] }),
          10,
        );
        // eslint-disable-next-line no-console
        console.warn(`${action.label} — échecs (${failures.length}) :\n${failures.join('\n')}`);
      } else {
        message.success(action.success(ok));
      }
      onDone();
      if (failures.length === 0) onClear();
    } finally {
      setRunning(null);
    }
  };

  return (
    <Alert
      type="info"
      style={{ marginBottom: 16 }}
      icon={<CheckCircleOutlined />}
      showIcon
      message={
        <Space wrap>
          <Typography.Text strong>{t('selected', { count: selected.length })}</Typography.Text>
          {actions.map((action) => {
            const targets = selected.filter(action.eligible);
            const ignored = selected.length - targets.length;
            const busy = running?.action === action.key;
            const label = busy
              ? t('running', { label: action.label, done: running.done, total: running.total })
              : action.label;
            return (
              <Popconfirm
                key={action.key}
                title={t('confirmTitle', { label: action.label, count: targets.length })}
                description={
                  action.description || ignored > 0 ? (
                    <div style={{ maxWidth: 340 }}>
                      {action.description}
                      {ignored > 0 && (
                        <div style={{ marginTop: action.description ? 4 : 0 }}>
                          {t('ignored', { count: ignored, reason: action.skipped })}
                        </div>
                      )}
                    </div>
                  ) : undefined
                }
                okText={action.label}
                cancelText={tCommon('cancel')}
                disabled={targets.length === 0 || running !== null}
                onConfirm={() => run(action, targets)}
              >
                <Tooltip
                  title={
                    targets.length === 0
                      ? t('noTarget', { reason: action.skipped || t('emptySelection') })
                      : undefined
                  }
                >
                  <Button
                    size="small"
                    icon={action.icon}
                    loading={busy}
                    disabled={targets.length === 0 || (running !== null && !busy)}
                  >
                    {label}
                    {ignored > 0 && targets.length > 0 ? ` (${targets.length})` : ''}
                  </Button>
                </Tooltip>
              </Popconfirm>
            );
          })}
          <Button size="small" type="link" onClick={onClear} disabled={running !== null}>
            {t('clearAll')}
          </Button>
        </Space>
      }
    />
  );
}
