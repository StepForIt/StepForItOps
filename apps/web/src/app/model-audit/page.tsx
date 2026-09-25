'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { AuditRunResult, CatalogProposal, ModelParcRow, ModelParcSummary, TaskProfile } from './types';

const TIER_LABELS: Record<string, string> = {
  light: 'léger',
  standard: 'intermédiaire',
  reasoning: 'raisonnement',
};

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  preview: { color: 'blue', label: 'préversion' },
  deprecated: { color: 'orange', label: 'déprécié' },
  retired: { color: 'red', label: 'retiré' },
};

/**
 * L'audit des modèles, vu du parc.
 *
 * Un finding par workflow dit « ce workflow appelle un modèle retiré » quatorze
 * fois sans jamais dire « quatorze workflows sont concernés ». C'est cette
 * page-là qui le dit — et la colonne des tâches est ce qui fait comprendre d'un
 * coup d'œil pourquoi un modèle cher n'a rien à faire là.
 */
export default function ModelAuditPage() {
  const [tab, setTab] = usePersistedState<'parc' | 'tasks' | 'catalog'>('tab', 'parc', {
    validate: (value) => (value === 'parc' || value === 'tasks' || value === 'catalog' ? value : undefined),
  });
  const [summary, setSummary] = useState<ModelParcSummary | null>(null);
  const [proposals, setProposals] = useState<CatalogProposal[]>([]);
  const [profiles, setProfiles] = useState<TaskProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<ModelParcSummary>('/model-audit/summary'),
      apiGet<CatalogProposal[]>('/model-catalog/proposals'),
      apiGet<TaskProfile[]>('/model-catalog/task-profiles'),
    ])
      .then(([parc, pending, taskProfiles]) => {
        setSummary(parc);
        setProposals(pending);
        setProfiles(taskProfiles);
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const runAudit = async () => {
    setRunning(true);
    try {
      const result = await apiPost<AuditRunResult>('/model-audit/run');
      message.success(
        `${result.workflows} workflow(s) audité(s), ${result.findings} remarque(s)` +
          (result.catalogStale ? ` — catalogue périmé (${result.catalogAgeDays} j)` : ''),
      );
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const refreshCatalog = () => {
    Modal.confirm({
      title: 'Rafraîchir le catalogue des modèles ?',
      content: 'Crée des propositions à relire.',
      okText: 'Rafraîchir',
      cancelText: 'Annuler',
      onOk: async () => {
        try {
          const results =
            await apiPost<Array<{ source: string; proposed: number }>>('/model-catalog/refresh');
          const total = results.reduce((sum, result) => sum + result.proposed, 0);
          message.success(total > 0 ? `${total} proposition(s) à relire.` : 'Rien à changer.');
          load();
        } catch (error) {
          message.error((error as Error).message);
        }
      },
    });
  };

  const decide = async (ids: string[], action: 'apply' | 'reject') => {
    try {
      await apiPost(`/model-catalog/proposals/${action}`, { ids });
      message.success(action === 'apply' ? 'Catalogue mis à jour.' : 'Propositions écartées.');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const freshness = summary?.freshness;

  return (
    <Card
      title="Audit des modèles IA"
      loading={loading && !summary}
      extra={
        <Space wrap>
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as typeof tab)}
            options={[
              { label: 'Parc', value: 'parc' },
              { label: 'Tâches', value: 'tasks' },
              { label: `Catalogue${proposals.length ? ` (${proposals.length})` : ''}`, value: 'catalog' },
            ]}
          />
          <Button icon={<SyncOutlined />} loading={running} onClick={runAudit}>
            Auditer le parc
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refreshCatalog}>
            Rafraîchir le catalogue
          </Button>
        </Space>
      }
    >
      {freshness?.stale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Catalogue périmé (${freshness.ageDays} j) : obsolescence et économies en pause.`}
        />
      )}

      {tab === 'parc' && <ParcTable rows={summary?.models ?? []} />}
      {tab === 'tasks' && <TaskProfiles profiles={profiles} onSaved={load} />}
      {tab === 'catalog' && <Proposals rows={proposals} onDecide={decide} />}
    </Card>
  );
}

function ParcTable({ rows }: { rows: ModelParcRow[] }) {
  if (rows.length === 0) {
    return <Empty description="Aucun nœud LLM dans le parc synchronisé." />;
  }
  return (
    <Table<ModelParcRow> dataSource={rows} rowKey="model" size="small" pagination={false}>
      <Table.Column<ModelParcRow>
        title="Modèle"
        dataIndex="model"
        render={(model: string, row) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{model}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[row.provider, row.tier && (TIER_LABELS[row.tier] ?? row.tier)].filter(Boolean).join(' · ')}
            </Typography.Text>
          </Space>
        )}
      />
      <Table.Column<ModelParcRow>
        title="État"
        dataIndex="status"
        render={(status: string | null, row) => {
          if (!row.known) {
            return (
              <Tooltip title="Absent du catalogue">
                <Tag>inconnu</Tag>
              </Tooltip>
            );
          }
          const tag = status ? STATUS_TAG[status] : undefined;
          return (
            <Space direction="vertical" size={0}>
              {tag && <Tag color={tag.color}>{tag.label}</Tag>}
              {row.retiresAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  retrait le {row.retiresAt.slice(0, 10)}
                </Typography.Text>
              )}
              {row.replacedByPattern && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  → {row.replacedByPattern}
                </Typography.Text>
              )}
            </Space>
          );
        }}
      />
      <Table.Column<ModelParcRow>
        title="Parc"
        render={(_, row) => (
          <Tooltip title={row.workflowNames.slice(0, 12).join(', ')}>
            <span>
              {row.workflows} workflow{row.workflows > 1 ? 's' : ''} · {row.nodes} nœud
              {row.nodes > 1 ? 's' : ''}
            </span>
          </Tooltip>
        )}
      />
      <Table.Column<ModelParcRow>
        title="Tâches classées"
        dataIndex="tasks"
        render={(tasks: Record<string, number>) => {
          const entries = Object.entries(tasks);
          if (entries.length === 0) {
            return <Typography.Text type="secondary">—</Typography.Text>;
          }
          return (
            <Space size={4} wrap>
              {entries.map(([task, count]) => (
                <Tag key={task}>
                  {task} · {count} nœud{count > 1 ? 's' : ''}
                </Tag>
              ))}
            </Space>
          );
        }}
      />
      <Table.Column<ModelParcRow>
        title="Coût 30 j"
        dataIndex="costUsd30d"
        align="right"
        render={(cost: number, row) =>
          row.calls30d === 0 ? (
            <Tooltip title="Aucun appel sur 30 j">
              <Typography.Text type="secondary">non mesuré</Typography.Text>
            </Tooltip>
          ) : (
            <span>{cost.toFixed(2)} $</span>
          )
        }
      />
    </Table>
  );
}

/**
 * Les planchers par tâche : l'endroit où l'on conteste un verdict d'économie,
 * plutôt que dans le prompt d'un modèle.
 */
function TaskProfiles({ profiles, onSaved }: { profiles: TaskProfile[]; onSaved: () => void }) {
  const save = async (task: string, minTier: string) => {
    try {
      await apiPut(`/model-catalog/task-profiles/${task}`, { minTier });
      message.success('Plancher enregistré.');
      onSaved();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <>
      <Table<TaskProfile> dataSource={profiles} rowKey="task" size="small" pagination={false}>
        <Table.Column<TaskProfile> title="Tâche" dataIndex="label" />
        <Table.Column<TaskProfile>
          title="Niveau minimal"
          dataIndex="minTier"
          render={(minTier: string, row) => (
            <Select
              size="small"
              style={{ width: 180 }}
              value={minTier}
              onChange={(value) => save(row.task, value)}
              options={Object.entries(TIER_LABELS).map(([value, label]) => ({ value, label }))}
            />
          )}
        />
      </Table>
    </>
  );
}

function Proposals({
  rows,
  onDecide,
}: {
  rows: CatalogProposal[];
  onDecide: (ids: string[], action: 'apply' | 'reject') => void;
}) {
  const [selected, setSelected] = useState<React.Key[]>([]);
  if (rows.length === 0) {
    return <Empty description="Aucune proposition." />;
  }
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          disabled={selected.length === 0}
          onClick={() => onDecide(selected as string[], 'apply')}
        >
          Appliquer ({selected.length})
        </Button>
        <Button disabled={selected.length === 0} onClick={() => onDecide(selected as string[], 'reject')}>
          Écarter
        </Button>
      </Space>
      <Table<CatalogProposal>
        dataSource={rows}
        rowKey="id"
        size="small"
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
      >
        <Table.Column<CatalogProposal> title="Modèle" dataIndex="pattern" />
        <Table.Column<CatalogProposal> title="Champ" dataIndex="field" />
        <Table.Column<CatalogProposal>
          title="Actuel"
          dataIndex="currentValue"
          render={(value: unknown) => <code>{String(value ?? '—')}</code>}
        />
        <Table.Column<CatalogProposal>
          title="Proposé"
          dataIndex="proposedValue"
          render={(value: unknown) => (
            <Typography.Text strong>
              <code>{String(value ?? '—')}</code>
            </Typography.Text>
          )}
        />
        <Table.Column<CatalogProposal>
          title="Origine"
          dataIndex="origin"
          render={(origin: string, row) => (
            <Tooltip title={row.evidence ?? ''}>
              <Tag color={origin === 'ai' ? 'purple' : 'blue'}>{origin}</Tag>
            </Tooltip>
          )}
        />
      </Table>
    </>
  );
}
