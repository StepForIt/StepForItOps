'use client';

import React, { useEffect } from 'react';
import { usePersistedState, useTable } from '../../lib/list-memory/use-list-memory';
import { Empty, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { RedoOutlined } from '@ant-design/icons';
import type { ErrorCategory, ErrorGroupRow, ErrorGroupStatus } from './types';
import { CATEGORY_META } from './types';
import { STATUS_META, formatDate } from './error-group-status';

const STATUS_TABS: Array<{ label: string; value: ErrorGroupStatus | 'all' }> = [
  { label: 'À traiter', value: 'open' },
  { label: 'Traités', value: 'resolved' },
  { label: 'Ignorés', value: 'ignored' },
  { label: 'Tous', value: 'all' },
];

interface Props {
  /** Filtres pilotés par la page (portée d'instance, graphes, recherche). */
  filters: {
    instanceId?: string;
    externalWorkflowId?: string;
    days: number;
    /** Jour précis cliqué dans le graphe : ne garde que les problèmes tombés ce jour-là. */
    from?: string;
    to?: string;
    q?: string;
  };
  instanceName: (id: string) => string;
  showInstance: boolean;
  onOpen: (group: ErrorGroupRow) => void;
  /** Incrémenté par la page après une action, pour rafraîchir la liste. */
  refreshKey: number;
}

/**
 * Vue « problèmes » : une ligne = une erreur, quel que soit le nombre de fois
 * où elle est tombée. C'est ici qu'on marque traité et qu'on repère les rechutes.
 */
export function ErrorGroupsTable({ filters, instanceName, showInstance, onOpen, refreshKey }: Props) {
  const [status, setStatus] = usePersistedState<ErrorGroupStatus | 'all'>('groupStatus', 'open', {
    validate: (value) => STATUS_TABS.find((tab) => tab.value === value)?.value,
  });
  const [category, setCategory] = usePersistedState<ErrorCategory | undefined>('groupCategory', undefined, {
    validate: (value) =>
      typeof value === 'string' && value in CATEGORY_META ? (value as ErrorCategory) : undefined,
  });
  const { tableProps, setFilters, tableQueryResult } = useTable<ErrorGroupRow>({
    resource: 'error-groups',
    sorters: { initial: [{ field: 'lastSeenAt', order: 'desc' }] },
    syncWithLocation: false,
    // Filtres connus dès le premier rendu : sans cela le premier chargement
    // ramènerait les problèmes de toutes les instances avant de se corriger.
    filters: {
      initial: [
        ...(filters.instanceId
          ? [{ field: 'instanceId', operator: 'eq' as const, value: filters.instanceId }]
          : []),
        { field: 'days', operator: 'eq' as const, value: filters.days },
        ...(filters.externalWorkflowId
          ? [{ field: 'externalWorkflowId', operator: 'eq' as const, value: filters.externalWorkflowId }]
          : []),
        ...(filters.q ? [{ field: 'q', operator: 'eq' as const, value: filters.q }] : []),
        ...(status === 'all' ? [] : [{ field: 'status', operator: 'eq' as const, value: status }]),
        ...(category ? [{ field: 'category', operator: 'eq' as const, value: category }] : []),
      ],
    },
  });

  useEffect(() => {
    setFilters(
      [
        { field: 'instanceId', operator: 'eq', value: filters.instanceId },
        { field: 'externalWorkflowId', operator: 'eq', value: filters.externalWorkflowId },
        { field: 'days', operator: 'eq', value: filters.from ? undefined : filters.days },
        { field: 'from', operator: 'eq', value: filters.from },
        { field: 'to', operator: 'eq', value: filters.to },
        { field: 'q', operator: 'eq', value: filters.q || undefined },
        { field: 'status', operator: 'eq', value: status === 'all' ? undefined : status },
        { field: 'category', operator: 'eq', value: category },
      ],
      'merge',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.instanceId,
    filters.externalWorkflowId,
    filters.days,
    filters.from,
    filters.to,
    filters.q,
    status,
    category,
  ]);

  useEffect(() => {
    if (refreshKey > 0) tableQueryResult.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          options={STATUS_TABS}
          value={status}
          onChange={(value) => setStatus(value as ErrorGroupStatus | 'all')}
        />
        <Select
          allowClear
          placeholder="Type de problème"
          style={{ minWidth: 170 }}
          value={category}
          onChange={(value) => setCategory(value as ErrorCategory | undefined)}
          options={Object.entries(CATEGORY_META).map(([value, meta]) => ({
            value,
            label: <Tag color={meta.color}>{meta.label}</Tag>,
          }))}
        />
      </Space>
      <Table
        {...tableProps}
        className="groups-table"
        rowKey="id"
        size="small"
        tableLayout="fixed"
        onRow={(record) => ({ onClick: () => onOpen(record), style: { cursor: 'pointer' } })}
        locale={{
          emptyText: (
            <Empty
              description={
                status === 'open' ? 'Rien à traiter sur la période.' : 'Aucun problème dans cet état.'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
      >
        <Table.Column<ErrorGroupRow>
          dataIndex="status"
          title="Statut"
          width={130}
          render={(value: ErrorGroupStatus, record) => (
            <Space direction="vertical" size={2}>
              {status !== value && <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>}
              {record.regressions > 0 && (
                <Tooltip title="Le problème est revenu après avoir été marqué traité.">
                  <Tag color="volcano" icon={<RedoOutlined />}>
                    {record.regressions} rechute{record.regressions > 1 ? 's' : ''}
                  </Tag>
                </Tooltip>
              )}
            </Space>
          )}
        />
        <Table.Column dataIndex="workflowName" title="Workflow" sorter width={200} ellipsis />
        {showInstance && (
          <Table.Column<ErrorGroupRow>
            title="Instance"
            width={130}
            render={(_, record) => <Tag color="geekblue">{instanceName(record.instanceId)}</Tag>}
          />
        )}
        <Table.Column<ErrorGroupRow>
          dataIndex="failedNode"
          title="Nœud"
          width={160}
          render={(node: string | null) =>
            node ? <Tag color="red">{node}</Tag> : <Typography.Text type="secondary">—</Typography.Text>
          }
        />
        <Table.Column<ErrorGroupRow>
          dataIndex="category"
          title="Type"
          width={110}
          render={(value: ErrorCategory) => {
            const meta = CATEGORY_META[value] ?? CATEGORY_META.other;
            return value === 'other' ? (
              <Typography.Text type="secondary">—</Typography.Text>
            ) : (
              <Tag color={meta.color}>{meta.label}</Tag>
            );
          }}
        />
        <Table.Column<ErrorGroupRow>
          dataIndex="pattern"
          title="Problème"
          ellipsis
          render={(pattern: string, record) => <Tooltip title={record.sample ?? pattern}>{pattern}</Tooltip>}
        />
        <Table.Column
          dataIndex="occurrences"
          title="Fois"
          sorter
          width={80}
          align="right"
          render={(value: number) => <strong>{value}</strong>}
        />
        <Table.Column
          dataIndex="lastSeenAt"
          title="Dernière fois"
          sorter
          width={160}
          render={(value: string) => formatDate(value)}
        />
      </Table>
    </>
  );
}
