'use client';

import React from 'react';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Space, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { useTranslations } from 'next-intl';

interface ExportTarget {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
}

export default function ExportTargetsList() {
  const t = useTranslations('settings.exportTargets');
  const tc = useTranslations('common');
  const { tableProps, sorters } = useTable<ExportTarget>({
    resource: 'export-targets',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  return (
    <List headerButtons={<CreateButton />}>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="name"
          title={tc('columns.name')}
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
        />
        <Table.Column
          dataIndex="kind"
          title={tc('columns.type')}
          sorter
          defaultSortOrder={getDefaultSortOrder('kind', sorters)}
          render={(k: string) => <Tag>{k}</Tag>}
        />
        <Table.Column
          dataIndex="enabled"
          title={t('enabled')}
          sorter
          defaultSortOrder={getDefaultSortOrder('enabled', sorters)}
          render={(e: boolean) => (e ? <Tag color="green">{t('yes')}</Tag> : <Tag>{t('no')}</Tag>)}
        />
        <Table.Column<ExportTarget>
          title={tc('columns.actions')}
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
