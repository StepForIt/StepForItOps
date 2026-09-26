'use client';

import React from 'react';
import { getDefaultSortOrder } from '@refinedev/antd';
import { CrudFilters } from '@refinedev/core';
import Link from 'next/link';
import { Space, Tag, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { WorkflowActions } from './workflow-actions';
import { WorkflowNameCell } from './workflow-name-cell';
import { DivergenceTag } from './divergence-tag';
import { WorkflowRow, WorkflowSelection } from './workflow-row';
import { useEnvColor } from '../../lib/envs';
import { useWorkflowList } from './use-workflow-list';
import { formatDate } from './format-date';
import { useEnabledModules } from '../../lib/enabled-modules';

/** Vue plate : une ligne par workflow n8n. */
export function WorkflowsTable({
  filters,
  search,
  instanceId,
  showInstance,
  instanceName,
  selection,
}: {
  filters: CrudFilters;
  /** Terme cherché : c'est lui qui autorise la synchro de rattrapage, pas les autres filtres. */
  search?: string;
  instanceId: string | null;
  showInstance: boolean;
  instanceName: (id: string) => string;
  /** Cases à cocher des actions groupées, tenues par la page. */
  selection: WorkflowSelection;
}) {
  const t = useTranslations('workflowsList.shared');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const date = (value: string | null) => formatDate(value, locale);
  const { enabled } = useEnabledModules();
  const showGroups = !enabled || enabled.includes('workflow-groups');
  const envColor = useEnvColor();
  const { tableProps, sorters, syncing, refetch } = useWorkflowList<WorkflowRow>({
    resource: 'workflows',
    filters,
    search,
    instanceId,
  });

  return (
    <Table
      {...tableProps}
      rowKey="id"
      loading={tableProps.loading || syncing}
      rowSelection={{
        selectedRowKeys: selection.ids,
        // antd ne rend que les lignes de la page courante : le scope est cette
        // page, pour qu'une sélection faite page 1 survive à un passage page 2.
        onChange: (_keys, rows) => selection.onSelect((tableProps.dataSource ?? []) as WorkflowRow[], rows),
      }}
    >
      <Table.Column<WorkflowRow>
        dataIndex="name"
        title={tCommon('columns.name')}
        sorter
        defaultSortOrder={getDefaultSortOrder('name', sorters)}
        render={(_, record) => <WorkflowNameCell workflow={record} />}
      />
      {showInstance && (
        <Table.Column
          dataIndex="instanceId"
          title={tCommon('columns.instance')}
          render={(id: string) => <Tag color="blue">{instanceName(id)}</Tag>}
        />
      )}
      <Table.Column
        dataIndex="env"
        title={tCommon('columns.env')}
        render={(env: WorkflowRow['env']) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>)}
      />
      <Table.Column
        dataIndex="divergence"
        title={t('columns.divergence')}
        render={(divergence: WorkflowRow['divergence'], row: WorkflowRow) => (
          <DivergenceTag workflowId={row.id} divergence={divergence} />
        )}
      />
      <Table.Column
        dataIndex="active"
        title={t('columns.active')}
        sorter
        defaultSortOrder={getDefaultSortOrder('active', sorters)}
        render={(active: boolean) =>
          active ? <Tag color="green">{t('active')}</Tag> : <Tag>{t('inactive')}</Tag>
        }
      />
      {showGroups && (
        <Table.Column
          dataIndex="groups"
          title={t('columns.group')}
          render={(groups: WorkflowRow['groups']) =>
            !groups || groups.length === 0 ? (
              <Typography.Text type="secondary">—</Typography.Text>
            ) : (
              <Space size={4} wrap>
                {groups.map((group) => (
                  <Link key={group.id} href={`/workflow-groups/edit/${group.id}`}>
                    <Tag color="purple">{group.name}</Tag>
                  </Link>
                ))}
              </Space>
            )
          }
        />
      )}
      <Table.Column
        dataIndex="tags"
        title={t('columns.tags')}
        render={(tags: string[]) => tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}
      />
      <Table.Column
        dataIndex="monitorCount"
        title={t('columns.monitoring')}
        render={(count: number) =>
          count > 0 ? (
            <Tag color="green">{t('probes', { count })}</Tag>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )
        }
      />
      <Table.Column
        dataIndex="upstreamUpdatedAt"
        title={t('columns.upstreamUpdated')}
        sorter
        defaultSortOrder={getDefaultSortOrder('upstreamUpdatedAt', sorters)}
        render={date}
      />
      <Table.Column
        dataIndex="updatedAt"
        title={t('columns.synced')}
        sorter
        defaultSortOrder={getDefaultSortOrder('updatedAt', sorters)}
        render={date}
      />
      <Table.Column<WorkflowRow>
        key="actions"
        title={tCommon('columns.actions')}
        className="row-actions"
        render={(_, record) => <WorkflowActions workflow={record} onChange={refetch} />}
      />
    </Table>
  );
}
