'use client';

import React from 'react';
import Link from 'next/link';
import { getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { CrudFilters } from '@refinedev/core';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { useEnvColor } from '../../lib/envs';
import { VersionActions, VersionHandlers, formatDateTime } from './version-actions';
import { VersionHistoryTable } from './history-table';

/** Dernière version d'un exemplaire (un env) du workflow métier. */
interface LatestVersion {
  id: string;
  workflowId: string;
  workflow: { name: string; instanceId: string };
  env: string | null;
  hash: string;
  origin: string;
  createdAt: string;
  exportedAt: string | null;
  exportedTo: string[];
  versionCount: number;
  previousAt: string | null;
}

interface VersionFamily {
  id: string;
  name: string;
  envs: string[];
  unknownEnvCount: number;
  instanceIds: string[];
  memberCount: number;
  versionCount: number;
  createdAt: string;
  notExportedCount: number;
  members: LatestVersion[];
}

/**
 * Trois niveaux : le workflow métier, ses environnements, et sous chacun son
 * historique. La vue par exemplaire posait « Facturation - DEV » et
 * « Facturation - PROD » à deux endroits de la liste, alors que la question
 * qu'on se pose ici les compare — l'écart entre les deux se lit maintenant
 * sur une seule ligne dépliée.
 *
 * Le regroupement vient de l'API (`/versions/families`) : fait dans le
 * navigateur, il ne verrait que la page courante.
 */
export function VersionFamiliesTable({
  filters,
  scope,
  instanceName,
  handlers,
}: {
  filters: CrudFilters;
  scope: string | null;
  instanceName: (id?: string) => string;
  handlers: VersionHandlers;
}) {
  const envColor = useEnvColor();
  const c = useTranslations('inventory.versions.columns');
  const tt = useTranslations('inventory.versions.table');
  const locale = useLocale();
  const { tableProps, sorters } = useTable<VersionFamily>({
    resource: 'versions/families',
    filters: { permanent: filters },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
  });

  /** Niveau 2 : un exemplaire par env, son historique replié dessous. */
  const members = (family: VersionFamily) => (
    <Table<LatestVersion>
      dataSource={family.members}
      rowKey="id"
      pagination={false}
      size="small"
      mobileLayout={{ title: 'workflow.name', badges: ['env'] }}
      expandable={{
        // Une version unique n'a rien à déplier : pas de chevron qui ouvre du vide.
        rowExpandable: (record) => record.versionCount > 1,
        expandedRowRender: (record) => (
          <VersionHistoryTable workflowId={record.workflowId} handlers={handlers} />
        ),
      }}
    >
      <Table.Column<LatestVersion>
        dataIndex="env"
        title={c('env')}
        render={(env: LatestVersion['env']) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>)}
      />
      <Table.Column<LatestVersion>
        dataIndex={['workflow', 'name']}
        title={c('workflow')}
        render={(name: string, record) => (
          <Link href={`/workflows/show/${record.workflowId}`}>{name ?? record.workflowId}</Link>
        )}
      />
      {!scope && (
        <Table.Column<LatestVersion>
          title={c('instance')}
          render={(_, record) => <Tag color="blue">{instanceName(record.workflow?.instanceId)}</Tag>}
        />
      )}
      <Table.Column
        dataIndex="hash"
        title={c('hash')}
        render={(h: string) => <code>{h.slice(0, 10)}</code>}
      />
      <Table.Column dataIndex="origin" title={c('origin')} render={(o: string) => <Tag>{o}</Tag>} />
      <Table.Column
        dataIndex="createdAt"
        title={c('lastVersion')}
        render={(d: string) => formatDateTime(d, locale)}
      />
      <Table.Column<LatestVersion>
        dataIndex="versionCount"
        title={c('versions')}
        render={(count: number, record) => (
          <Tooltip
            title={
              record.previousAt
                ? tt('previous', { date: formatDateTime(record.previousAt, locale) })
                : undefined
            }
          >
            <Typography.Text>{count}</Typography.Text>
          </Tooltip>
        )}
      />
      <Table.Column<LatestVersion>
        dataIndex="exportedAt"
        title={c('exported')}
        render={(d: string | null, record) =>
          d ? (
            <Tooltip title={record.exportedTo?.join(', ')}>
              <Typography.Text>{formatDateTime(d, locale)}</Typography.Text>
            </Tooltip>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )
        }
      />
      <Table.Column<LatestVersion>
        title={c('actions')}
        className="row-actions"
        render={(_, record) => <VersionActions versionId={record.id} handlers={handlers} />}
      />
    </Table>
  );

  return (
    <Table
      {...tableProps}
      rowKey="id"
      mobileLayout={{ badges: ['envs'] }}
      expandable={{ expandedRowRender: members }}
    >
      <Table.Column<VersionFamily>
        dataIndex="name"
        title={c('workflow')}
        sorter
        defaultSortOrder={getDefaultSortOrder('name', sorters)}
        render={(name: string) => <Typography.Text strong>{name}</Typography.Text>}
      />
      <Table.Column<VersionFamily>
        dataIndex="envs"
        title={c('envs')}
        render={(envs: VersionFamily['envs'], record) => (
          <Space size={4}>
            {envs.map((env) => (
              <Tag key={env} color={envColor(env)}>
                {env}
              </Tag>
            ))}
            {record.unknownEnvCount > 0 && (
              <Tooltip title={tt('declarable')}>
                <Tag>{tt('noEnv', { count: record.unknownEnvCount })}</Tag>
              </Tooltip>
            )}
          </Space>
        )}
      />
      <Table.Column<VersionFamily>
        dataIndex="createdAt"
        title={c('lastVersion')}
        sorter
        defaultSortOrder={getDefaultSortOrder('createdAt', sorters)}
        render={(d: string) => formatDateTime(d, locale)}
      />
      <Table.Column<VersionFamily>
        dataIndex="versionCount"
        title={c('versions')}
        sorter
        defaultSortOrder={getDefaultSortOrder('versionCount', sorters)}
        render={(count: number) => <Typography.Text>{count}</Typography.Text>}
      />
      <Table.Column<VersionFamily>
        dataIndex="notExportedCount"
        title={c('exported')}
        render={(notExported: number, record) =>
          notExported === 0 ? null : (
            <Tag color="orange">{tt('neverExported', { notExported, total: record.memberCount })}</Tag>
          )
        }
      />
    </Table>
  );
}
