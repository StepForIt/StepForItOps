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
          title="Nom"
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
          render={(name: string, record) => <Link href={`/instances/show/${record.id}`}>{name}</Link>}
        />
        <Table.Column<Instance>
          dataIndex="platform"
          title="Plateforme"
          sorter
          defaultSortOrder={getDefaultSortOrder('platform', sorters)}
          render={(platform: Instance['platform']) => (
            <Tag color={platform === 'make' ? 'purple' : 'blue'}>{platform === 'make' ? 'Make' : 'n8n'}</Tag>
          )}
        />
        <Table.Column<Instance>
          dataIndex="baseUrl"
          title="Adresse"
          sorter
          defaultSortOrder={getDefaultSortOrder('baseUrl', sorters)}
          // Pour un compte Make, `baseUrl` est déduite de la zone : l'afficher
          // montrerait une URL que personne n'a saisie. Ce qui identifie le
          // compte, c'est la zone et la team.
          render={(baseUrl: string, record) =>
            record.platform === 'make'
              ? `${record.zone ?? '—'}${record.externalTeamId ? ` · team ${record.externalTeamId}` : ''}`
              : baseUrl
          }
        />
        <Table.Column<Instance>
          title="Actions"
          className="row-actions"
          render={(_, record) => (
            <Space>
              <Button size="small" type="primary" onClick={() => setSyncInstance(record)}>
                Synchroniser
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
