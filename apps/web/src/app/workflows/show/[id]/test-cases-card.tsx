'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { Table } from '../../../../components/resizable-table';
import { CaretRightOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost } from '../../../../lib/api';

type DiffKind = 'value' | 'type' | 'missing' | 'extra' | 'count' | 'normalization';

interface SnapshotDiff {
  path: string;
  field: string;
  kind: DiffKind;
  expected?: string;
  actual?: string;
  message: string;
}

interface TestCaseRow {
  id: string;
  name: string;
  enabled: boolean;
  lastStatus: 'passed' | 'failed' | 'error' | null;
  lastRunAt: string | null;
  /** SnapshotDiff[] ; les rejeux d'avant n'avaient que des chaînes brutes. */
  lastDiff: unknown[] | null;
  lastMessage: string | null;
  lastExecutionId: string | null;
  sourceExecutionId: string | null;
}

/** Nature de l'écart : ce que l'utilisateur doit en conclure, en un mot. */
const DIFF_META: Record<DiffKind, { color: string; label: DiffLabel }> = {
  value: { color: 'red', label: 'value' },
  type: { color: 'red', label: 'type' },
  missing: { color: 'orange', label: 'missing' },
  extra: { color: 'blue', label: 'extra' },
  count: { color: 'orange', label: 'count' },
  normalization: { color: 'default', label: 'normalization' },
};

/** Clé de libellé d'un écart (`testCases.diff.*`). */
type DiffLabel = DiffKind | 'unknown';

/** Nature inconnue : un écart reste un écart, on ne prétend pas savoir lequel. */
const UNKNOWN_META: { color: string; label: DiffLabel } = { color: 'default', label: 'unknown' };

/** Une ligne de détail prête à afficher, quelle que soit la forme stockée. */
interface RenderableDiff {
  key: string;
  color: string;
  label: DiffLabel;
  message: string;
  /** Chemin machine, seulement quand l'entrée en porte un vrai. */
  path?: string;
}

/**
 * `lastDiff` est du jsonb écrit par une version de l'API qui n'est pas
 * forcément celle-ci : rejeux d'avant la refonte (chaînes brutes), ou nature
 * d'écart ajoutée plus tard. Un onglet resté ouvert pendant un déploiement
 * suffit à faire cohabiter les deux — et un objet rendu tel quel fait tomber
 * toute la carte. On dégrade l'affichage, jamais le rendu.
 */
function toRenderable(entry: unknown, index: number): RenderableDiff {
  const key = `diff-${index}`;
  if (typeof entry === 'string') return { key, ...UNKNOWN_META, message: entry };
  const diff = (entry ?? {}) as Partial<SnapshotDiff>;
  const meta = (diff.kind && DIFF_META[diff.kind]) || UNKNOWN_META;
  return {
    key,
    ...meta,
    message: typeof diff.message === 'string' ? diff.message : JSON.stringify(entry),
    path: typeof diff.path === 'string' ? diff.path : undefined,
  };
}

interface ExecutionOption {
  id: string;
  status: string;
  startedAt?: string;
  mode?: string;
}

/**
 * Le statut se lit sans décodeur : « rouge » ne disait pas si le workflow avait
 * planté ou simplement produit autre chose — c'est pourtant deux enquêtes
 * différentes.
 */
const STATUS_COLOR: Record<NonNullable<TestCaseRow['lastStatus']>, string> = {
  passed: 'green',
  failed: 'red',
  error: 'volcano',
};

/**
 * Cas de test enregistrés : une exécution réelle jugée bonne devient la
 * référence. Rejouer appelle RÉELLEMENT le webhook (une exécution part sur
 * n8n) — c'est dit sur le bouton. Le dernier statut alimente le gate de
 * promotion.
 */
export function TestCasesCard({ workflowId }: { workflowId: string }) {
  const t = useTranslations('workflowShow.testCases');
  const locale = useLocale();
  const [rows, setRows] = useState<TestCaseRow[]>([]);
  const [executions, setExecutions] = useState<ExecutionOption[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<TestCaseRow[]>(`/tester/cases/${workflowId}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [workflowId]);

  useEffect(load, [load]);
  useEffect(() => {
    apiGet<ExecutionOption[]>(`/tester/executions/${workflowId}`)
      .then(setExecutions)
      .catch(() => setExecutions([]));
  }, [workflowId]);

  const create = async () => {
    if (!selectedExecution) return;
    setBusy('create');
    try {
      await apiPost(`/tester/cases/from-execution/${workflowId}`, { executionId: selectedExecution });
      message.success(t('created'));
      setSelectedExecution(undefined);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string) => {
    setBusy(id);
    try {
      const result = await apiPost<{ status: string; message?: string }>(`/tester/cases/${id}/run`);
      const said = result.message ?? t('detailBelow');
      if (result.status === 'passed') message.success(t('passedMsg', { said }));
      else if (result.status === 'failed') message.warning(t('failedMsg', { said }));
      else message.error(t('errorMsg', { said }));
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    setBusy('all');
    try {
      const { results } = await apiPost<{ results: Array<{ status: string }> }>(
        `/tester/cases/run-all/${workflowId}`,
      );
      const passed = results.filter((r) => r.status === 'passed').length;
      message.info(t('runAllResult', { passed, total: results.length }));
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    await apiDelete(`/tester/cases/${id}`).catch((error) => message.error((error as Error).message));
    load();
  };

  return (
    <Card
      size="small"
      title={t('title')}
      style={{ marginTop: 16 }}
      extra={
        rows.length > 0 && (
          <Tooltip title={t('runAllTooltip')}>
            <Button icon={<CaretRightOutlined />} loading={busy === 'all'} onClick={runAll}>
              {t('runAll', { count: rows.length })}
            </Button>
          </Tooltip>
        )
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ minWidth: 320 }}
          placeholder={t('selectPlaceholder')}
          value={selectedExecution}
          onChange={setSelectedExecution}
          options={executions.map((execution) => ({
            value: execution.id,
            label: `#${execution.id} — ${execution.status}${execution.startedAt ? ` — ${new Date(execution.startedAt).toLocaleString(locale)}` : ''}`,
          }))}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!selectedExecution}
          loading={busy === 'create'}
          onClick={create}
        >
          {t('create')}
        </Button>
      </Space>
      <Table
        dataSource={rows}
        rowKey="id"
        size="small"
        pagination={false}
        locale={{ emptyText: t('empty') }}
        expandable={{
          rowExpandable: (record) =>
            Boolean(record.lastMessage) || Boolean(record.lastDiff && record.lastDiff.length > 0),
          expandedRowRender: (record) => (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {record.lastMessage && <Typography.Text strong>{record.lastMessage}</Typography.Text>}
              {record.lastExecutionId && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('replayExecution', { id: record.lastExecutionId })}
                </Typography.Text>
              )}
              {(record.lastDiff ?? []).map(toRenderable).map((diff) => (
                <div key={diff.key}>
                  <Space size={6} align="start" wrap>
                    <Tag color={diff.color}>{t(`diff.${diff.label}`)}</Tag>
                    <Typography.Text>{diff.message}</Typography.Text>
                  </Space>
                  {diff.path && (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t.rich('inOutput', {
                          path: diff.path,
                          code: (chunks) => <Typography.Text code>{chunks}</Typography.Text>,
                        })}
                      </Typography.Text>
                    </div>
                  )}
                </div>
              ))}
            </Space>
          ),
        }}
      >
        <Table.Column dataIndex="name" title={t('columnCase')} />
        <Table.Column<TestCaseRow>
          dataIndex="lastStatus"
          title={t('columnLastRun')}
          width={180}
          render={(status: TestCaseRow['lastStatus'], record) =>
            status ? (
              <Space size={4}>
                <Tooltip title={t(`status.${status}.hint`)}>
                  <Tag color={STATUS_COLOR[status]}>{t(`status.${status}.label`)}</Tag>
                </Tooltip>
                {record.lastRunAt && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(record.lastRunAt).toLocaleString(locale)}
                  </Typography.Text>
                )}
              </Space>
            ) : (
              <Tag>{t('neverRun')}</Tag>
            )
          }
        />
        <Table.Column<TestCaseRow>
          title=""
          width={110}
          render={(_, record) => (
            <Space>
              <Tooltip title={t('replayTooltip')}>
                <Button
                  size="small"
                  icon={<CaretRightOutlined />}
                  loading={busy === record.id}
                  onClick={() => run(record.id)}
                />
              </Tooltip>
              <Popconfirm title={t('deleteConfirm')} onConfirm={() => remove(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>
    </Card>
  );
}
