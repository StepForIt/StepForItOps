'use client';

import React, { useState } from 'react';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Button, Space, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { ScanOutlined } from '@ant-design/icons';
import { WorkflowScanDrawer } from '../../components/workflow-scan-drawer';
import { useTranslations } from 'next-intl';

interface Mapping {
  id: string;
  provider: string;
  logicalName: string;
  values: Record<string, unknown>;
}

export default function MappingsList() {
  const t = useTranslations('settings.resourceMappings');
  const tc = useTranslations('common');
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
            {t('discover')}
          </Button>
          <CreateButton />
          <WorkflowScanDrawer open={scanOpen} onClose={() => setScanOpen(false)} />
        </>
      }
    >
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="provider"
          title={t('provider')}
          sorter
          defaultSortOrder={getDefaultSortOrder('provider', sorters)}
          render={(p: string) => <Tag>{p}</Tag>}
        />
        <Table.Column
          dataIndex="logicalName"
          title={t('logicalName')}
          sorter
          defaultSortOrder={getDefaultSortOrder('logicalName', sorters)}
        />
        <Table.Column
          dataIndex="values"
          title={t('envs')}
          render={(values: Record<string, unknown>) =>
            Object.keys(values ?? {}).map((env) => (
              <Tag key={env} color="blue">
                {env}
              </Tag>
            ))
          }
        />
        <Table.Column<Mapping>
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
