'use client';

import React from 'react';
import Link from 'next/link';
import { getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { CrudFilters } from '@refinedev/core';
import { Tag, Tooltip, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { VersionActions, VersionHandlers, formatDateTime } from './version-actions';
import { VersionHistoryTable } from './history-table';

interface LatestVersion {
  id: string;
  workflowId: string;
  workflow: { name: string; instanceId: string };
  hash: string;
  origin: string;
  message: string | null;
  createdAt: string;
  exportedAt: string | null;
  exportedTo: string[];
  versionCount: number;
  previousAt: string | null;
}

/**
 * Une ligne par workflow : son état COURANT, ses versions antérieures repliées
 * dessous. La liste à plat rendait la page inutilisable — un workflow qui change
 * toutes les heures y occupait toutes les pages, et les autres workflows
 * n'apparaissaient plus. Rien n'est masqué pour autant : l'historique se déplie
 * sur place, comme les environnements d'une famille sur la liste Workflows.
 */
export function LatestVersionsTable({
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
  const c = useTranslations('inventory.versions.columns');
  const tt = useTranslations('inventory.versions.table');
  const locale = useLocale();
  const { tableProps, sorters } = useTable<LatestVersion>({
    resource: 'versions/latest',
    filters: { permanent: filters },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
  });

  return (
    <Table
      {...tableProps}
      rowKey="id"
      expandable={{
        // Une version unique n'a rien à déplier : pas de chevron qui ouvre du vide.
        rowExpandable: (record) => record.versionCount > 1,
        expandedRowRender: (record) => (
          <VersionHistoryTable workflowId={record.workflowId} handlers={handlers} />
        ),
      }}
    >
      <Table.Column<LatestVersion>
        dataIndex={['workflow', 'name']}
        title={c('workflow')}
        sorter
        defaultSortOrder={getDefaultSortOrder('workflow.name', sorters)}
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
      <Table.Column
        dataIndex="origin"
        title={c('origin')}
        sorter
        defaultSortOrder={getDefaultSortOrder('origin', sorters)}
        render={(o: string) => <Tag>{o}</Tag>}
      />
      <Table.Column
        dataIndex="createdAt"
        title={c('lastVersion')}
        sorter
        defaultSortOrder={getDefaultSortOrder('createdAt', sorters)}
        render={(d: string) => formatDateTime(d, locale)}
      />
      <Table.Column<LatestVersion>
        dataIndex="versionCount"
        title={c('versions')}
        sorter
        defaultSortOrder={getDefaultSortOrder('versionCount', sorters)}
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
        sorter
        defaultSortOrder={getDefaultSortOrder('exportedAt', sorters)}
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
}
