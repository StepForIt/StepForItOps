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
import { apiPost } from '../../lib/api';
import { runWithConcurrency } from '../../lib/concurrency';
import { WorkflowRow } from './workflow-row';

/** Workflows traités de front : chaque action est un aller-retour vers n8n. */
const BULK_CONCURRENCY = 4;

interface BulkAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Participe du toast de fin (« 3/5 archivés »). */
  done: string;
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
async function analyse(workflow: WorkflowRow): Promise<void> {
  const results = await Promise.allSettled([
    apiPost(`/verifier/run/${workflow.id}?ai=1`),
    apiPost(`/js-checker/run/${workflow.id}?ai=1`),
    apiPost(`/optimizer/analyze/${workflow.id}`),
    apiPost(`/field-checker/run/${workflow.id}`),
  ]);
  if (results.some((result) => result.status === 'fulfilled')) return;
  const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  throw new Error((first?.reason as Error)?.message ?? 'analyse en échec');
}

const ACTIONS: BulkAction[] = [
  {
    key: 'resync',
    label: 'Resynchroniser',
    icon: <ReloadOutlined />,
    done: 'resynchronisé',
    eligible: () => true,
    skipped: '',
    run: (workflow) => apiPost(`/workflows/${workflow.id}/resync`),
  },
  {
    key: 'analyse',
    label: 'Analyser',
    icon: <SafetyOutlined />,
    done: 'analysé',
    description: 'Structure, JS, naming, champs — IA incluse (lent)',
    eligible: (workflow) => !workflow.missingInN8n,
    skipped: 'absents de n8n',
    run: analyse,
  },
  {
    key: 'archive',
    label: 'Archiver',
    icon: <InboxOutlined />,
    done: 'archivé',
    description: 'Tag + préfixe [ARCHIVED], rien n’est supprimé',
    eligible: (workflow) => !workflow.archived && !workflow.archivedUpstream && !workflow.missingInN8n,
    skipped: 'déjà archivés ou absents',
    run: (workflow) => apiPost(`/workflows/${workflow.id}/archive`),
  },
  {
    key: 'unarchive',
    label: 'Désarchiver',
    icon: <UndoOutlined />,
    // Archivé DANS n8n : l'API publique refuse d'y toucher, le retour se fait dans n8n.
    done: 'désarchivé',
    description: 'Retire le tag et le préfixe [ARCHIVED]',
    eligible: (workflow) => workflow.archived && !workflow.archivedUpstream && !workflow.missingInN8n,
    skipped: 'non archivés par la plateforme',
    run: (workflow) => apiPost(`/workflows/${workflow.id}/unarchive`),
  },
];

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
        const n = failures.length;
        message.warning(
          `${ok}/${targets.length} ${action.done}s — ${n} échec${n > 1 ? 's' : ''} : ${failures[0]}`,
          10,
        );
        // eslint-disable-next-line no-console
        console.warn(`${action.label} — échecs (${failures.length}) :\n${failures.join('\n')}`);
      } else {
        const s = ok > 1 ? 's' : '';
        message.success(`${ok} workflow${s} ${action.done}${s}`);
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
          <Typography.Text strong>
            {selected.length} workflow{selected.length > 1 ? 's' : ''} sélectionné
            {selected.length > 1 ? 's' : ''}
          </Typography.Text>
          {ACTIONS.map((action) => {
            const targets = selected.filter(action.eligible);
            const ignored = selected.length - targets.length;
            const busy = running?.action === action.key;
            const label = busy ? `${action.label}… ${running.done}/${running.total}` : action.label;
            return (
              <Popconfirm
                key={action.key}
                title={`${action.label} ${targets.length} workflow${targets.length > 1 ? 's' : ''} ?`}
                description={
                  action.description || ignored > 0 ? (
                    <div style={{ maxWidth: 340 }}>
                      {action.description}
                      {ignored > 0 && (
                        <div style={{ marginTop: action.description ? 4 : 0 }}>
                          {ignored} ignoré{ignored > 1 ? 's' : ''} ({action.skipped})
                        </div>
                      )}
                    </div>
                  ) : undefined
                }
                okText={action.label}
                cancelText="Annuler"
                disabled={targets.length === 0 || running !== null}
                onConfirm={() => run(action, targets)}
              >
                <Tooltip
                  title={
                    targets.length === 0
                      ? `Aucune ligne concernée (${action.skipped || 'sélection vide'})`
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
            Tout décocher
          </Button>
        </Space>
      }
    />
  );
}
