'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  List,
  getDefaultSortOrder,
  EditButton,
  DeleteButton,
  CreateButton,
  ShowButton,
} from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Button, Space, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { useTranslations } from 'next-intl';
import { SyncModal } from './sync-modal';

interface Instance {
  id: string;
  name: string;
  baseUrl: string;
  platform: 'n8n' | 'make';
  zone: string | null;
  externalTeamId: string | null;
}

export default function InstancesList() {
  const t = useTranslations('settings.instances');
  const tc = useTranslations('common');
  const { tableProps, sorters } = useTable<Instance>({
    resource: 'instances',
    syncWithLocation: true,
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });
  const [syncInstance, setSyncInstance] = useState<Instance | null>(null);

  return (
    <List headerButtons={<CreateButton />}>
      <Table {...tableProps} rowKey="id">
        <Table.Column<Instance>
          dataIndex="name"
          title={tc('columns.name')}
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
          render={(name: string, record) => <Link href={`/instances/show/${record.id}`}>{name}</Link>}
        />
        <Table.Column<Instance>
          dataIndex="platform"
          title={t('platform')}
          sorter
          defaultSortOrder={getDefaultSortOrder('platform', sorters)}
          render={(platform: Instance['platform']) => (
            <Tag color={platform === 'make' ? 'purple' : 'blue'}>{platform === 'make' ? 'Make' : 'n8n'}</Tag>
          )}
        />
        <Table.Column<Instance>
          dataIndex="baseUrl"
          title={t('address')}
          sorter
          defaultSortOrder={getDefaultSortOrder('baseUrl', sorters)}
          // Pour un compte Make, `baseUrl` est déduite de la zone : l'afficher
          // montrerait une URL que personne n'a saisie. Ce qui identifie le
          // compte, c'est la zone et la team.
          render={(baseUrl: string, record) =>
            record.platform === 'make'
              ? record.externalTeamId
                ? t('makeAddressTeam', { zone: record.zone ?? '—', team: record.externalTeamId })
                : (record.zone ?? '—')
              : baseUrl
          }
        />
        <Table.Column<Instance>
          title={tc('columns.actions')}
          className="row-actions"
          render={(_, record) => (
            <Space>
              <Button size="small" type="primary" onClick={() => setSyncInstance(record)}>
                {t('sync')}
              </Button>
              <ShowButton hideText size="small" recordItemId={record.id} />
              <EditButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>

      <SyncModal
        instanceId={syncInstance?.id ?? null}
        instanceName={syncInstance?.name}
        onClose={() => setSyncInstance(null)}
      />
    </List>
  );
}
