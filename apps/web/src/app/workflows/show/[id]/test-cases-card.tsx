'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { Table } from '../../../../components/resizable-table';
import { CaretRightOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
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
const DIFF_META: Record<DiffKind, { color: string; label: string }> = {
  value: { color: 'red', label: 'valeur différente' },
  type: { color: 'red', label: 'type différent' },
  missing: { color: 'orange', label: 'champ disparu' },
  extra: { color: 'blue', label: 'champ en plus' },
  count: { color: 'orange', label: 'nombre d’éléments' },
  normalization: { color: 'default', label: 'artefact de comparaison' },
};

/** Nature inconnue : un écart reste un écart, on ne prétend pas savoir lequel. */
const UNKNOWN_META = { color: 'default', label: 'écart' };

/** Une ligne de détail prête à afficher, quelle que soit la forme stockée. */
interface RenderableDiff {
  key: string;
  color: string;
  label: string;
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
const STATUS_META: Record<string, { color: string; label: string; hint: string }> = {
  passed: {
    color: 'green',
    label: 'conforme',
    hint: 'Le rejeu a produit la même sortie que la référence (ids et dates neutralisés).',
  },
  failed: {
    color: 'red',
    label: 'sortie différente',
    hint: 'Le workflow est allé au bout, mais sa sortie ne correspond plus à la référence : le détail est sous la ligne.',
  },
  error: {
    color: 'volcano',
    label: 'rejeu impossible',
    hint: 'Rien n’a pu être comparé : webhook absent, workflow inactif, ou aucune exécution déclenchée.',
  },
};

/**
 * Cas de test enregistrés : une exécution réelle jugée bonne devient la
 * référence. Rejouer appelle RÉELLEMENT le webhook (une exécution part sur
 * n8n) — c'est dit sur le bouton. Le dernier statut alimente le gate de
 * promotion.
 */
export function TestCasesCard({ workflowId }: { workflowId: string }) {
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
      message.success('Cas de test créé : cette exécution est maintenant la référence.');
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
      const said = result.message ?? 'Détail sous la ligne.';
      if (result.status === 'passed') message.success(`Conforme — ${said}`);
      else if (result.status === 'failed') message.warning(`Sortie différente — ${said}`);
      else message.error(`Rejeu impossible — ${said}`);
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
      message.info(`${passed}/${results.length} conformes`);
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
      title="Cas de test enregistrés"
      style={{ marginTop: 16 }}
      extra={
        rows.length > 0 && (
          <Tooltip title="Rejoue chaque cas : le webhook est réellement appelé, une exécution part sur n8n.">
            <Button icon={<CaretRightOutlined />} loading={busy === 'all'} onClick={runAll}>
              Tout rejouer ({rows.length})
            </Button>
          </Tooltip>
        )
      }
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ minWidth: 320 }}
          placeholder="Choisir une exécution récente comme référence…"
          value={selectedExecution}
          onChange={setSelectedExecution}
          options={executions.map((execution) => ({
            value: execution.id,
            label: `#${execution.id} — ${execution.status}${execution.startedAt ? ` — ${new Date(execution.startedAt).toLocaleString('fr-FR')}` : ''}`,
          }))}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!selectedExecution}
          loading={busy === 'create'}
          onClick={create}
        >
          En faire un cas de test
        </Button>
      </Space>
      <Table
        dataSource={rows}
        rowKey="id"
        size="small"
        pagination={false}
        locale={{ emptyText: 'Aucun cas de test — enregistre une exécution de référence ci-dessus.' }}
        expandable={{
          rowExpandable: (record) =>
            Boolean(record.lastMessage) || Boolean(record.lastDiff && record.lastDiff.length > 0),
          expandedRowRender: (record) => (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {record.lastMessage && <Typography.Text strong>{record.lastMessage}</Typography.Text>}
              {record.lastExecutionId && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Exécution n8n du rejeu : #{record.lastExecutionId}
                </Typography.Text>
              )}
              {(record.lastDiff ?? []).map(toRenderable).map((diff) => (
                <div key={diff.key}>
                  <Space size={6} align="start" wrap>
                    <Tag color={diff.color}>{diff.label}</Tag>
                    <Typography.Text>{diff.message}</Typography.Text>
                  </Space>
                  {diff.path && (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        dans la sortie : <Typography.Text code>{diff.path}</Typography.Text>
                      </Typography.Text>
                    </div>
                  )}
                </div>
              ))}
            </Space>
          ),
        }}
      >
        <Table.Column dataIndex="name" title="Cas" />
        <Table.Column<TestCaseRow>
          dataIndex="lastStatus"
          title="Dernier rejeu"
          width={180}
          render={(status: TestCaseRow['lastStatus'], record) =>
            status ? (
              <Space size={4}>
                <Tooltip title={STATUS_META[status].hint}>
                  <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
                </Tooltip>
                {record.lastRunAt && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(record.lastRunAt).toLocaleString('fr-FR')}
                  </Typography.Text>
                )}
              </Space>
            ) : (
              <Tag>jamais joué</Tag>
            )
          }
        />
        <Table.Column<TestCaseRow>
          title=""
          width={110}
          render={(_, record) => (
            <Space>
              <Tooltip title="Rejouer (appelle réellement le webhook)">
                <Button
                  size="small"
                  icon={<CaretRightOutlined />}
                  loading={busy === record.id}
                  onClick={() => run(record.id)}
                />
              </Tooltip>
              <Popconfirm title="Supprimer ce cas de test ?" onConfirm={() => remove(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>
    </Card>
  );
}
