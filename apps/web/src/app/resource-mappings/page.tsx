'use client';

import React, { useState } from 'react';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Button, Space, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { ScanOutlined } from '@ant-design/icons';
import { WorkflowScanDrawer } from '../../components/workflow-scan-drawer';

interface Mapping {
  id: string;
  provider: string;
  logicalName: string;
  values: Record<string, unknown>;
}

export default function MappingsList() {
  const { tableProps, sorters } = useTable<Mapping>({
    resource: 'resource-mappings',
    sorters: { initial: [{ field: 'logicalName', order: 'asc' }] },
  });
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <List
      headerButtons={
        <>
          <Button icon={<ScanOutlined />} onClick={() => setScanOpen(true)}>
            Découvrir depuis un workflow
          </Button>
          <CreateButton />
          <WorkflowScanDrawer open={scanOpen} onClose={() => setScanOpen(false)} />
        </>
      }
    >
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="provider"
          title="Provider"
          sorter
          defaultSortOrder={getDefaultSortOrder('provider', sorters)}
          render={(p: string) => <Tag>{p}</Tag>}
        />
        <Table.Column
          dataIndex="logicalName"
          title="Nom logique"
          sorter
          defaultSortOrder={getDefaultSortOrder('logicalName', sorters)}
        />
        <Table.Column
          dataIndex="values"
          title="Environnements"
          render={(values: Record<string, unknown>) =>
            Object.keys(values ?? {}).map((env) => (
              <Tag key={env} color="blue">
                {env}
              </Tag>
            ))
          }
        />
        <Table.Column<Mapping>
          title="Actions"
          className="row-actions"
          render={(_, record) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
}
