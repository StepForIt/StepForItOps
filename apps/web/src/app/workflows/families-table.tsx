'use client';

import React from 'react';
import { getDefaultSortOrder } from '@refinedev/antd';
import { CrudFilters } from '@refinedev/core';
import { Space, Tag, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { WorkflowActions } from './workflow-actions';
import { WorkflowNameCell } from './workflow-name-cell';
import { DivergenceTag } from './divergence-tag';
import { FamilyDivergence } from './family-divergence';
import { FamilyEnvTags } from './family-env-tags';
import { formatDate } from './format-date';
import { FamilySelection, WorkflowFamily, WorkflowRow, WorkflowSelection } from './workflow-row';
import { useEnvColor } from '../../lib/envs';
import { useWorkflowList } from './use-workflow-list';

/**
 * Vue groupée : une ligne par workflow métier, ses environnements en dessous.
 * Le regroupement vient de l'API (`/workflows/families`) : fait dans le navigateur,
 * il ne verrait que la page courante et couperait les familles en deux.
 */
export function WorkflowFamiliesTable({
  filters,
  search,
  instanceId,
  instanceName,
  selection,
  familySelection,
}: {
  filters: CrudFilters;
  /** Terme cherché : c'est lui qui autorise la synchro de rattrapage, pas les autres filtres. */
  search?: string;
  instanceId: string | null;
  instanceName: (id: string) => string;
  /** Cases à cocher des actions groupées : elles vivent sur les MEMBRES, pas sur la famille — archiver « X » d'un clic emporterait la prod avec le dev. */
  selection: WorkflowSelection;
  familySelection: FamilySelection;
}) {
  const t = useTranslations('workflowsList.shared');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const date = (value: string | null) => formatDate(value, locale);
  const envColor = useEnvColor();
  const { tableProps, sorters, syncing, refetch } = useWorkflowList<WorkflowFamily>({
    resource: 'workflows/families',
    filters,
    search,
    instanceId,
  });

  const members = (family: WorkflowFamily) => (
    <Table<WorkflowRow>
      dataSource={family.members}
      rowKey="id"
      pagination={false}
      size="small"
      rowSelection={{
        selectedRowKeys: selection.ids.filter((id) => family.members.some((member) => member.id === id)),
        onChange: (_keys, rows) => selection.onSelect(family.members, rows),
      }}
    >
      <Table.Column<WorkflowRow>
        title={tCommon('columns.name')}
        dataIndex="name"
        render={(_, record) => <WorkflowNameCell workflow={record} />}
      />
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
        dataIndex="instanceId"
        title={tCommon('columns.instance')}
        render={(id: string) => <Tag color="blue">{instanceName(id)}</Tag>}
      />
      <Table.Column
        dataIndex="active"
        title={t('columns.active')}
        render={(active: boolean) =>
          active ? <Tag color="green">{t('active')}</Tag> : <Tag>{t('inactive')}</Tag>
        }
      />
      <Table.Column dataIndex="upstreamUpdatedAt" title={t('columns.upstreamUpdated')} render={date} />
      <Table.Column dataIndex="updatedAt" title={t('columns.synced')} render={date} />
      <Table.Column<WorkflowRow>
        key="actions"
        title={tCommon('columns.actions')}
        className="row-actions"
        render={(_, record) => <WorkflowActions workflow={record} onChange={refetch} />}
      />
    </Table>
  );

  return (
    <Table
      {...tableProps}
      rowKey="id"
      loading={tableProps.loading || syncing}
      rowSelection={{
        selectedRowKeys: familySelection.keys,
        onChange: (_keys, rows) => familySelection.onSelect([...(tableProps.dataSource ?? [])], rows),
      }}
      expandable={{ expandedRowRender: members, defaultExpandAllRows: false }}
    >
      <Table.Column<WorkflowFamily>
        dataIndex="name"
        title={tCommon('columns.workflow')}
        sorter
        defaultSortOrder={getDefaultSortOrder('name', sorters)}
        render={(name: string) => <Typography.Text strong>{name}</Typography.Text>}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="envs"
        title={t('columns.envs')}
        render={(_, record) => <FamilyEnvTags family={record} />}
      />
      <Table.Column<WorkflowFamily>
        key="deploy"
        title={t('columns.divergence')}
        render={(_, record) => <FamilyDivergence family={record} />}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="memberCount"
        title={t('columns.copies')}
        sorter
        defaultSortOrder={getDefaultSortOrder('memberCount', sorters)}
        render={(_, record) => (
          <Space size={4}>
            {record.missingCount > 0 && (
              <Tag color="volcano">{t('missingCount', { count: record.missingCount })}</Tag>
            )}
            {record.archivedCount > 0 && (
              <Typography.Text type="secondary">
                {t('archivedCount', { count: record.archivedCount })}
              </Typography.Text>
            )}
          </Space>
        )}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="instanceIds"
        title={t('columns.instances')}
        render={(ids: string[]) => (
          <Space size={4} wrap>
            {ids.map((id) => (
              <Tag key={id} color="blue">
                {instanceName(id)}
              </Tag>
            ))}
          </Space>
        )}
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
    </Table>
  );
}
