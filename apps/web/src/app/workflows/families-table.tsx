'use client';

import React from 'react';
import { getDefaultSortOrder } from '@refinedev/antd';
import { CrudFilters } from '@refinedev/core';
import { Space, Tag, Typography } from 'antd';
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
        title="Nom"
        dataIndex="name"
        render={(_, record) => <WorkflowNameCell workflow={record} />}
      />
      <Table.Column
        dataIndex="env"
        title="Env"
        render={(env: WorkflowRow['env']) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>)}
      />
      <Table.Column
        dataIndex="divergence"
        title="Écart prod"
        render={(divergence: WorkflowRow['divergence'], row: WorkflowRow) => (
          <DivergenceTag workflowId={row.id} divergence={divergence} />
        )}
      />
      <Table.Column
        dataIndex="instanceId"
        title="Instance"
        render={(id: string) => <Tag color="geekblue">{instanceName(id)}</Tag>}
      />
      <Table.Column
        dataIndex="active"
        title="Actif"
        render={(active: boolean) => (active ? <Tag color="green">actif</Tag> : <Tag>inactif</Tag>)}
      />
      <Table.Column dataIndex="upstreamUpdatedAt" title="Modifié (n8n)" render={formatDate} />
      <Table.Column dataIndex="updatedAt" title="Synchronisé" render={formatDate} />
      <Table.Column<WorkflowRow>
        title="Actions"
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
        title="Workflow"
        sorter
        defaultSortOrder={getDefaultSortOrder('name', sorters)}
        render={(name: string) => <Typography.Text strong>{name}</Typography.Text>}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="envs"
        title="Environnements"
        render={(_, record) => <FamilyEnvTags family={record} />}
      />
      <Table.Column<WorkflowFamily>
        key="deploy"
        title="Écart prod"
        render={(_, record) => <FamilyDivergence family={record} />}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="memberCount"
        title="Copies"
        sorter
        defaultSortOrder={getDefaultSortOrder('memberCount', sorters)}
        render={(_, record) => (
          <Space size={4}>
            {record.missingCount > 0 && <Tag color="volcano">{record.missingCount} absent(s) de n8n</Tag>}
            {record.archivedCount > 0 && (
              <Typography.Text type="secondary">{record.archivedCount} archivé(s)</Typography.Text>
            )}
          </Space>
        )}
      />
      <Table.Column<WorkflowFamily>
        dataIndex="instanceIds"
        title="Instances"
        render={(ids: string[]) => (
          <Space size={4} wrap>
            {ids.map((id) => (
              <Tag key={id} color="geekblue">
                {instanceName(id)}
              </Tag>
            ))}
          </Space>
        )}
      />
      <Table.Column
        dataIndex="upstreamUpdatedAt"
        title="Modifié (n8n)"
        sorter
        defaultSortOrder={getDefaultSortOrder('upstreamUpdatedAt', sorters)}
        render={formatDate}
      />
      <Table.Column
        dataIndex="updatedAt"
        title="Synchronisé"
        sorter
        defaultSortOrder={getDefaultSortOrder('updatedAt', sorters)}
        render={formatDate}
      />
    </Table>
  );
}
