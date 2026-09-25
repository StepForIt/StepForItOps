'use client';

import React from 'react';
import { getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { CrudFilters } from '@refinedev/core';
import { Tag, Tooltip, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { VersionActions, VersionHandlers, frDate } from './version-actions';

interface Version {
  id: string;
  workflowId: string;
  workflow?: { name: string; instanceId?: string };
  hash: string;
  origin: string;
  /** Version publiée par la promotion qui a produit ce snapshot ; nulle pour une synchro. */
  semver?: string | null;
  message?: string;
  createdAt: string;
  exportedAt?: string;
  exportedTo: string[];
}

/**
 * Toutes les versions d'UN workflow, dépliées sous sa ligne. Montée à
 * l'ouverture du repli : les versions ne sont demandées que pour le workflow
 * qu'on regarde, jamais pour toute la page.
 */
export function VersionHistoryTable({
  workflowId,
  handlers,
}: {
  workflowId: string;
  handlers: VersionHandlers;
}) {
  const filters: CrudFilters = [{ field: 'workflowId', operator: 'eq', value: workflowId }];
  const { tableProps, sorters } = useTable<Version>({
    resource: 'versions',
    filters: { permanent: filters },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
  });

  return (
    <Table {...tableProps} rowKey="id" size="small">
      <Table.Column
        dataIndex="semver"
        title="Version"
        render={(v: string | null) =>
          v ? (
            <Tooltip title="Posée par une promotion">
              <Tag color="purple">v{v}</Tag>
            </Tooltip>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )
        }
      />
      <Table.Column dataIndex="hash" title="Hash" render={(h: string) => <code>{h.slice(0, 10)}</code>} />
      <Table.Column
        dataIndex="origin"
        title="Origine"
        sorter
        defaultSortOrder={getDefaultSortOrder('origin', sorters)}
        render={(o: string) => <Tag>{o}</Tag>}
      />
      <Table.Column dataIndex="message" title="Message" />
      <Table.Column
        dataIndex="createdAt"
        title="Créée"
        sorter
        defaultSortOrder={getDefaultSortOrder('createdAt', sorters)}
        render={(d: string) => frDate(d)}
      />
      <Table.Column<Version>
        dataIndex="exportedAt"
        title="Exporté"
        sorter
        defaultSortOrder={getDefaultSortOrder('exportedAt', sorters)}
        render={(d: string | undefined, record) =>
          d ? (
            <Tooltip title={record.exportedTo?.join(', ')}>
              <Typography.Text>{frDate(d)}</Typography.Text>
            </Tooltip>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )
        }
      />
      <Table.Column<Version>
        title="Actions"
        className="row-actions"
        render={(_, record) => <VersionActions versionId={record.id} handlers={handlers} />}
      />
    </Table>
  );
}
