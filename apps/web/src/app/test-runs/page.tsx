'use client';

import React from 'react';
import Link from 'next/link';
import { List, getDefaultSortOrder } from '@refinedev/antd';
import { usePersistedState, useTable } from '../../lib/list-memory/use-list-memory';
import { useSelect } from '@refinedev/core';
import { Empty, Select, Space, Tag, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { useInstanceScope } from '../../lib/instance-scope';

interface TestRun {
  id: string;
  workflowId: string;
  workflow?: { name: string; instanceId?: string };
  mode: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const statusColor: Record<string, string> = {
  success: 'green',
  error: 'red',
  running: 'blue',
  pending: 'default',
};

export default function TestRunsList() {
  const { scope, instanceName } = useInstanceScope();
  const [workflowId, setWorkflowId] = usePersistedState<string | undefined>('workflow', undefined);
  const { tableProps, setFilters, sorters } = useTable<TestRun>({
    resource: 'test-runs',
    syncWithLocation: true,
    sorters: { initial: [{ field: 'startedAt', order: 'desc' }] },
    // Scope connu dès le premier rendu (InstanceScopeGate) : premier chargement déjà filtré.
    filters: {
      initial: [
        ...(scope ? [{ field: 'instanceId', operator: 'eq' as const, value: scope }] : []),
        ...(workflowId ? [{ field: 'workflowId', operator: 'eq' as const, value: workflowId }] : []),
      ],
    },
  });
  const { options: workflowOptions } = useSelect({
    resource: 'workflows',
    optionLabel: 'name',
    optionValue: 'id',
    pagination: { pageSize: 200 },
    filters: scope ? [{ field: 'instanceId', operator: 'eq', value: scope }] : [],
  });

  // Scope global : force le filtre instance (retiré en mode « toutes les instances »)
  React.useEffect(() => {
    setFilters([{ field: 'instanceId', operator: 'eq', value: scope ?? undefined }], 'merge');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  return (
    <List>
      <Space style={{ marginBottom: 16, display: 'flex' }}>
        <Select
          placeholder="Filtrer par workflow"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 320, maxWidth: '100%' }}
          options={workflowOptions}
          value={workflowId}
          onChange={(value?: string) => {
            setWorkflowId(value || undefined);
            setFilters([{ field: 'workflowId', operator: 'eq', value: value || undefined }], 'merge');
          }}
        />
      </Space>
      <Table
        {...tableProps}
        rowKey="id"
        mobileLayout={{ badges: ['status'] }}
        locale={{
          emptyText: (
            <Empty
              description={
                <>
                  Aucun test lancé pour l&apos;instant.
                  <br />
                  Ouvre un workflow → onglet <b>Test</b> pour déclencher son webhook avec un payload.
                </>
              }
            />
          ),
        }}
        expandable={{
          expandedRowRender: (record: TestRun) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              {record.error && <Typography.Text type="danger">{record.error}</Typography.Text>}
              <b>Payload</b>
              <pre style={{ maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(record.input, null, 2)}</pre>
              <b>Résultat</b>
              <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(record.output, null, 2)}</pre>
            </Space>
          ),
        }}
      >
        <Table.Column<TestRun>
          dataIndex={['workflow', 'name']}
          title="Workflow"
          sorter
          defaultSortOrder={getDefaultSortOrder('workflow.name', sorters)}
          render={(name: string, record) => (
            <Link href={`/workflows/show/${record.workflowId}`}>{name ?? record.workflowId}</Link>
          )}
        />
        {!scope && (
          <Table.Column<TestRun>
            title="Instance"
            render={(_, record) => <Tag color="geekblue">{instanceName(record.workflow?.instanceId)}</Tag>}
          />
        )}
        <Table.Column
          dataIndex="mode"
          title="Mode"
          sorter
          defaultSortOrder={getDefaultSortOrder('mode', sorters)}
          render={(m: string) => <Tag>{m}</Tag>}
        />
        <Table.Column
          dataIndex="status"
          title="Statut"
          sorter
          defaultSortOrder={getDefaultSortOrder('status', sorters)}
          render={(s: string) => <Tag color={statusColor[s]}>{s}</Tag>}
        />
        <Table.Column
          dataIndex="startedAt"
          title="Démarré"
          sorter
          defaultSortOrder={getDefaultSortOrder('startedAt', sorters)}
          render={(d: string) => new Date(d).toLocaleString('fr-FR')}
        />
      </Table>
    </List>
  );
}
