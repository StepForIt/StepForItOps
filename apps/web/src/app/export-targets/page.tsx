'use client';

import React from 'react';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Space, Tag } from 'antd';
import { Table } from '../../components/resizable-table';

interface ExportTarget {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
}

export default function ExportTargetsList() {
  const { tableProps, sorters } = useTable<ExportTarget>({
    resource: 'export-targets',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  return (
    <List headerButtons={<CreateButton />}>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="name"
          title="Nom"
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
        />
        <Table.Column
          dataIndex="kind"
          title="Type"
          sorter
          defaultSortOrder={getDefaultSortOrder('kind', sorters)}
          render={(k: string) => <Tag>{k}</Tag>}
        />
        <Table.Column
          dataIndex="enabled"
          title="Activée"
          sorter
          defaultSortOrder={getDefaultSortOrder('enabled', sorters)}
          render={(e: boolean) => (e ? <Tag color="green">oui</Tag> : <Tag>non</Tag>)}
        />
        <Table.Column<ExportTarget>
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
