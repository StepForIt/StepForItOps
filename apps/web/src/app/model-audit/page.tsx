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
import { useTranslations } from 'next-intl';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { AuditRunResult, CatalogProposal, ModelParcRow, ModelParcSummary, TaskProfile } from './types';

/** Niveaux connus (libellé : `health.modelAudit.tiers.<code>`). */
const TIERS = ['light', 'standard', 'reasoning'] as const;
type Tier = (typeof TIERS)[number];
const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);

/** Couleur des statuts connus (libellé : `health.modelAudit.statuses.<code>`). */
const STATUS_TAG = {
  preview: { color: 'blue' },
  deprecated: { color: 'orange' },
  retired: { color: 'red' },
} as const;
type KnownStatus = keyof typeof STATUS_TAG;
const isKnownStatus = (value: string): value is KnownStatus => value in STATUS_TAG;

/**
 * L'audit des modèles, vu du parc.
 *
 * Un finding par workflow dit « ce workflow appelle un modèle retiré » quatorze
 * fois sans jamais dire « quatorze workflows sont concernés ». C'est cette
 * page-là qui le dit — et la colonne des tâches est ce qui fait comprendre d'un
 * coup d'œil pourquoi un modèle cher n'a rien à faire là.
 */
export default function ModelAuditPage() {
  const t = useTranslations('health.modelAudit');
  const tc = useTranslations('common');
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
        result.catalogStale
          ? t('auditedStale', {
              workflows: result.workflows,
              findings: result.findings,
              days: result.catalogAgeDays ?? '?',
            })
          : t('audited', { workflows: result.workflows, findings: result.findings }),
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
      title: t('refreshConfirm.title'),
      content: t('refreshConfirm.content'),
      okText: tc('refresh'),
      cancelText: tc('cancel'),
      onOk: async () => {
        try {
          const results =
            await apiPost<Array<{ source: string; proposed: number }>>('/model-catalog/refresh');
          const total = results.reduce((sum, result) => sum + result.proposed, 0);
          message.success(total > 0 ? t('proposalsToReview', { count: total }) : t('nothingToChange'));
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
      message.success(action === 'apply' ? t('catalogUpdated') : t('proposalsRejected'));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const freshness = summary?.freshness;

  return (
    <Card
      title={t('title')}
      loading={loading && !summary}
      extra={
        <Space wrap>
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as typeof tab)}
            options={[
              { label: t('tabs.parc'), value: 'parc' },
              { label: t('tabs.tasks'), value: 'tasks' },
              {
                label: proposals.length
                  ? t('tabs.catalogCount', { count: proposals.length })
                  : t('tabs.catalog'),
                value: 'catalog',
              },
            ]}
          />
          <Button icon={<SyncOutlined />} loading={running} onClick={runAudit}>
            {t('runAudit')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refreshCatalog}>
            {t('refreshCatalog')}
          </Button>
        </Space>
      }
    >
      {freshness?.stale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('staleCatalog', { days: freshness.ageDays ?? '?' })}
        />
      )}

      {tab === 'parc' && <ParcTable rows={summary?.models ?? []} />}
      {tab === 'tasks' && <TaskProfiles profiles={profiles} onSaved={load} />}
      {tab === 'catalog' && <Proposals rows={proposals} onDecide={decide} />}
    </Card>
  );
}

function ParcTable({ rows }: { rows: ModelParcRow[] }) {
  const t = useTranslations('health.modelAudit.parc');
  const tt = useTranslations('health.modelAudit');
  if (rows.length === 0) {
    return <Empty description={t('empty')} />;
  }
  return (
    <Table<ModelParcRow> dataSource={rows} rowKey="model" size="small" pagination={false}>
      <Table.Column<ModelParcRow>
        title={t('model')}
        dataIndex="model"
        render={(model: string, row) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{model}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[row.provider, row.tier && (isTier(row.tier) ? tt(`tiers.${row.tier}`) : row.tier)]
                .filter(Boolean)
                .join(' · ')}
            </Typography.Text>
          </Space>
        )}
      />
      <Table.Column<ModelParcRow>
        title={t('status')}
        dataIndex="status"
        render={(status: string | null, row) => {
          if (!row.known) {
            return (
              <Tooltip title={t('unknownTooltip')}>
                <Tag>{t('unknown')}</Tag>
              </Tooltip>
            );
          }
          const known = status && isKnownStatus(status) ? status : undefined;
          return (
            <Space direction="vertical" size={0}>
              {known && <Tag color={STATUS_TAG[known].color}>{tt(`statuses.${known}`)}</Tag>}
              {row.retiresAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('retiresAt', { date: row.retiresAt.slice(0, 10) })}
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
        title={t('parc')}
        render={(_, row) => (
          <Tooltip title={row.workflowNames.slice(0, 12).join(', ')}>
            <span>{t('usage', { workflows: row.workflows, nodes: row.nodes })}</span>
          </Tooltip>
        )}
      />
      <Table.Column<ModelParcRow>
        title={t('tasks')}
        dataIndex="tasks"
        render={(tasks: Record<string, number>) => {
          const entries = Object.entries(tasks);
          if (entries.length === 0) {
            return <Typography.Text type="secondary">—</Typography.Text>;
          }
          return (
            <Space size={4} wrap>
              {entries.map(([task, count]) => (
                <Tag key={task}>{t('taskNodes', { task, count })}</Tag>
              ))}
            </Space>
          );
        }}
      />
      <Table.Column<ModelParcRow>
        title={t('cost30d')}
        dataIndex="costUsd30d"
        align="right"
        render={(cost: number, row) =>
          row.calls30d === 0 ? (
            <Tooltip title={t('noCalls')}>
              <Typography.Text type="secondary">{t('notMeasured')}</Typography.Text>
            </Tooltip>
          ) : (
            <span>{t('usd', { cost: cost.toFixed(2) })}</span>
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
  const t = useTranslations('health.modelAudit');
  const save = async (task: string, minTier: string) => {
    try {
      await apiPut(`/model-catalog/task-profiles/${task}`, { minTier });
      message.success(t('taskProfiles.saved'));
      onSaved();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <>
      <Table<TaskProfile> dataSource={profiles} rowKey="task" size="small" pagination={false}>
        <Table.Column<TaskProfile> title={t('taskProfiles.task')} dataIndex="label" />
        <Table.Column<TaskProfile>
          title={t('taskProfiles.minTier')}
          dataIndex="minTier"
          render={(minTier: string, row) => (
            <Select
              size="small"
              style={{ width: 180 }}
              value={minTier}
              onChange={(value) => save(row.task, value)}
              options={TIERS.map((value) => ({ value, label: t(`tiers.${value}`) }))}
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
  const t = useTranslations('health.modelAudit.proposals');
  if (rows.length === 0) {
    return <Empty description={t('empty')} />;
  }
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          disabled={selected.length === 0}
          onClick={() => onDecide(selected as string[], 'apply')}
        >
          {t('apply', { count: selected.length })}
        </Button>
        <Button disabled={selected.length === 0} onClick={() => onDecide(selected as string[], 'reject')}>
          {t('reject')}
        </Button>
      </Space>
      <Table<CatalogProposal>
        dataSource={rows}
        rowKey="id"
        size="small"
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
      >
        <Table.Column<CatalogProposal> title={t('model')} dataIndex="pattern" />
        <Table.Column<CatalogProposal> title={t('field')} dataIndex="field" />
        <Table.Column<CatalogProposal>
          title={t('current')}
          dataIndex="currentValue"
          render={(value: unknown) => <code>{String(value ?? '—')}</code>}
        />
        <Table.Column<CatalogProposal>
          title={t('proposed')}
          dataIndex="proposedValue"
          render={(value: unknown) => (
            <Typography.Text strong>
              <code>{String(value ?? '—')}</code>
            </Typography.Text>
          )}
        />
        <Table.Column<CatalogProposal>
          title={t('origin')}
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
