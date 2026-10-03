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
import { Button, Space, Tag, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyPlaceholder, ListEmptyState } from '../../components/empty-state/list-empty-state';
import { SyncModal } from './sync-modal';
import { ApiKeyBanner } from '../../components/api-key-banner';
import { ApiKeyHealth, apiKeyAlert } from '../../lib/api-key/api-key-alert';
import { useEnabledModules } from '../../lib/enabled-modules';
import {
  FullAccessState,
  adminModuleEnabled,
  needsFullAccessPrompt,
} from '../../lib/full-access/full-access-prompt';

interface Instance extends ApiKeyHealth, FullAccessState {
  id: string;
  name: string;
  baseUrl: string;
  platform: 'n8n' | 'make';
  zone: string | null;
  externalTeamId: string | null;
}

export default function InstancesList() {
  const t = useTranslations('settings.instances');
  const tk = useTranslations('settings.apiKey');
  const ta = useTranslations('settings.fullAccess');
  const tc = useTranslations('common');
  const te = useTranslations('common.emptyState');
  const locale = useLocale();
  const { enabled } = useEnabledModules();
  const adminEnabled = adminModuleEnabled(enabled);
  const { tableProps, sorters } = useTable<Instance>({
    resource: 'instances',
    syncWithLocation: true,
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });
  const [syncInstance, setSyncInstance] = useState<Instance | null>(null);

  return (
    <List headerButtons={<CreateButton />}>
      <ApiKeyBanner instances={(tableProps.dataSource ?? []) as Instance[]} target="show" />
      <Table
        {...tableProps}
        rowKey="id"
        locale={{
          emptyText: tableProps.loading ? (
            <EmptyPlaceholder />
          ) : (
            <ListEmptyState
              idle={{
                title: te('noInstance.title'),
                text: te('noInstance.text'),
                actions: <CreateButton size="large">{te('noInstance.cta')}</CreateButton>,
              }}
            />
          ),
        }}
      >
        <Table.Column<Instance>
          dataIndex="name"
          title={tc('columns.name')}
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
          render={(name: string, record) => (
            <>
              <Link href={`/instances/show/${record.id}`}>{name}</Link>
              {/* La pastille mène à la fiche : c'est là que se renseigne le compte, ou que se refuse la demande. */}
              {needsFullAccessPrompt({ ...record, adminEnabled }) && (
                <Link href={`/instances/show/${record.id}`} style={{ marginLeft: 8 }}>
                  <Tag color="gold">{ta('partialTag')}</Tag>
                </Link>
              )}
            </>
          )}
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
          dataIndex="apiKeyExpiresAt"
          title={tk('column')}
          sorter
          defaultSortOrder={getDefaultSortOrder('apiKeyExpiresAt', sorters)}
          render={(_, record) => {
            const alert = apiKeyAlert(record);
            const label = record.apiKeyExpiresAt
              ? new Date(record.apiKeyExpiresAt).toLocaleDateString(locale)
              : tk('noDate');
            if (alert?.reason === 'rejected') return <Tag color="red">{tk('rejectedTag')}</Tag>;
            if (alert) return <Tag color={alert.level === 'error' ? 'red' : 'orange'}>{label}</Tag>;
            return record.apiKeyExpiresAt ? (
              label
            ) : (
              <Typography.Text type="secondary">{label}</Typography.Text>
            );
          }}
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
