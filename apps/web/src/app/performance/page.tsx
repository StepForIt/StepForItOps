'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Input, Segmented, Space, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { ReloadOutlined, RiseOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { useIsMobile } from '../../components/mobile/use-is-mobile';
import { ResponsiveCard } from '../../components/mobile/responsive-card';
import { PerfSummary, SampleResult, WorkflowPerfSummary, formatMs } from './types';
import { PerfTrendChart } from './perf-trend';

const PERIODS = [
  { label: '7 jours', value: 7 },
  { label: '14 jours', value: 14 },
  { label: '30 jours', value: 30 },
];

/** En dessous, le taux de succès mérite l'œil : tag orange puis rouge. */
const SUCCESS_WARN = 0.95;
const SUCCESS_BAD = 0.8;

function HeaderHelp({ label, title }: { label: string; title: string }) {
  return (
    <Tooltip title={title}>
      <span style={{ cursor: 'help', borderBottom: '1px dotted #999' }}>{label}</span>
    </Tooltip>
  );
}

/**
 * Performance des workflows : volume, taux de succès, P50/P95 et dérive de
 * durée vs la période précédente. La question n'est pas « combien de temps »
 * mais « est-ce que ça a changé ».
 */
export default function PerformancePage() {
  const mobile = useIsMobile();
  const { scope, instanceName } = useInstanceScope();
  const [days, setDays] = usePersistedState('days', 7, {
    validate: (value) => PERIODS.find((period) => period.value === value)?.value,
  });
  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sampling, setSampling] = useState(false);
  const [search, setSearch] = usePersistedState('search', '');
  const [onlyDrifted, setOnlyDrifted] = usePersistedState('onlyDrifted', false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (scope) params.set('instanceId', scope);
    apiGet<PerfSummary>(`/performance/summary?${params}`)
      .then(setSummary)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [scope, days]);

  useEffect(load, [load]);

  /** Poll immédiat des instances (sans attendre le passage des 5 min), puis rechargement. */
  const sampleNow = async () => {
    setSampling(true);
    try {
      const result = await apiPost<SampleResult>('/performance/sample');
      message.success(`${result.inserted} exécution(s) historisée(s)`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSampling(false);
    }
  };

  const rows = (summary?.workflows ?? []).filter(
    (row) =>
      (!search || row.name.toLowerCase().includes(search.toLowerCase())) && (!onlyDrifted || row.drifted),
  );

  const actions = (
    <Space wrap>
      <Segmented options={PERIODS} value={days} onChange={(value) => setDays(value as number)} />
      <Button icon={<ReloadOutlined />} onClick={sampleNow} loading={sampling || loading}>
        Rafraîchir
      </Button>
    </Space>
  );

  return (
    <ResponsiveCard title="Performance des workflows" extra={actions}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Rechercher un workflow…"
          allowClear
          style={{ width: mobile ? '100%' : 280 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Space>
          <Switch checked={onlyDrifted} onChange={setOnlyDrifted} />
          <span>Uniquement les dérives</span>
        </Space>
      </Space>
      <Table
        dataSource={rows}
        rowKey={(row) => `${row.instanceId}|${row.externalWorkflowId}`}
        loading={loading}
        size="small"
        mobileLayout={{ badges: ['driftRatio'] }}
        // Écran étroit : le tableau défile dans la carte au lieu de déborder de la page.
        scroll={{ x: 960 }}
        locale={{
          emptyText: 'Aucune exécution sur la période.',
        }}
        expandable={{
          expandedRowRender: (record: WorkflowPerfSummary) => (
            <PerfTrendChart
              instanceId={record.instanceId}
              externalWorkflowId={record.externalWorkflowId}
              days={30}
            />
          ),
        }}
      >
        <Table.Column<WorkflowPerfSummary>
          dataIndex="name"
          title="Workflow"
          render={(name: string, record) =>
            record.workflowId ? <Link href={`/workflows/show/${record.workflowId}`}>{name}</Link> : name
          }
        />
        {!scope && (
          <Table.Column<WorkflowPerfSummary>
            dataIndex="instanceId"
            title="Instance"
            width={140}
            render={(id: string) => <Tag color="geekblue">{instanceName(id)}</Tag>}
          />
        )}
        <Table.Column<WorkflowPerfSummary>
          dataIndex="executions"
          title="Exécutions"
          align="right"
          width={110}
          sorter={(a, b) => a.executions - b.executions}
          render={(value: number) => <strong>{value}</strong>}
        />
        <Table.Column<WorkflowPerfSummary>
          dataIndex="successRate"
          title="Succès"
          width={110}
          sorter={(a, b) => (a.successRate ?? 1) - (b.successRate ?? 1)}
          render={(rate: number | null, record) => {
            if (rate === null) return <Typography.Text type="secondary">—</Typography.Text>;
            const label = `${(rate * 100).toFixed(rate === 1 ? 0 : 1)} %`;
            if (rate >= SUCCESS_WARN) return label;
            return (
              <Tooltip title={`${record.errors} échec(s)`}>
                <Tag color={rate < SUCCESS_BAD ? 'red' : 'orange'}>{label}</Tag>
              </Tooltip>
            );
          }}
        />
        <Table.Column<WorkflowPerfSummary>
          dataIndex="p50Ms"
          title={<HeaderHelp label="P50" title="Durée médiane : la moitié des exécutions vont plus vite." />}
          align="right"
          width={100}
          sorter={(a, b) => (a.p50Ms ?? 0) - (b.p50Ms ?? 0)}
          render={(value: number | null) => formatMs(value)}
        />
        <Table.Column<WorkflowPerfSummary>
          dataIndex="p95Ms"
          title={<HeaderHelp label="P95" title="95 % des exécutions vont plus vite que cette durée." />}
          align="right"
          width={100}
          sorter={(a, b) => (a.p95Ms ?? 0) - (b.p95Ms ?? 0)}
          render={(value: number | null) => formatMs(value)}
        />
        <Table.Column<WorkflowPerfSummary>
          dataIndex="driftRatio"
          title={
            <HeaderHelp label="Tendance" title="Médiane de la période ÷ médiane de la période précédente." />
          }
          width={130}
          sorter={(a, b) => (a.driftRatio ?? 1) - (b.driftRatio ?? 1)}
          render={(ratio: number | null, record) => {
            if (ratio === null) return <Typography.Text type="secondary">—</Typography.Text>;
            if (record.drifted) {
              return (
                <Tooltip
                  title={`Médiane ×${ratio.toFixed(1)} vs les ${summary?.days ?? ''} jours précédents`}
                >
                  <Tag color="red" icon={<RiseOutlined />}>
                    ×{ratio.toFixed(1)} plus lent
                  </Tag>
                </Tooltip>
              );
            }
            if (ratio > 1.3) return <Tag color="orange">×{ratio.toFixed(1)}</Tag>;
            return <Typography.Text type="secondary">×{ratio.toFixed(1)}</Typography.Text>;
          }}
        />
        <Table.Column<WorkflowPerfSummary>
          dataIndex="lastAt"
          title="Dernière exécution"
          width={170}
          render={(value: string | null) => (value ? new Date(value).toLocaleString('fr-FR') : '—')}
        />
      </Table>
    </ResponsiveCard>
  );
}
