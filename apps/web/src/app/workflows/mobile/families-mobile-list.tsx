'use client';

import React from 'react';
import { CrudFilters } from '@refinedev/core';
import { Descriptions, List, Space, Tag, Typography } from 'antd';
import { useEnabledModules } from '../../../lib/enabled-modules';
import { useWorkflowList } from '../use-workflow-list';
import { FamilyDivergence } from '../family-divergence';
import { FamilyEnvTags } from '../family-env-tags';
import { formatDate } from '../format-date';
import { FamilySelection, WorkflowFamily, WorkflowRow, WorkflowSelection } from '../workflow-row';
import { RowEffect, selectionToggle, toggleExpanded } from '../../../components/mobile/mobile-gestures';
import { MobileRow } from '../../../components/mobile/mobile-row';
import { WorkflowMobileItem } from './workflow-mobile-item';
import { mobilePagination } from '../../../components/mobile/mobile-pagination';

/**
 * Vue groupée sur mobile : une ligne par workflow métier (nom + ses envs),
 * dépliable sur son résumé puis ses exemplaires, eux-mêmes dépliables. Même
 * requête que `WorkflowFamiliesTable`.
 *
 * Deux sélections, comme sur desktop : l'appui long sur un workflow métier le
 * coche pour les gestes d'environnement ; sur un exemplaire, pour les actions
 * groupées (resynchroniser, analyser, archiver…).
 */
export function FamiliesMobileList({
  filters,
  search,
  instanceId,
  instanceName,
  selection,
  familySelection,
  selecting,
}: {
  filters: CrudFilters;
  search?: string;
  instanceId: string | null;
  instanceName: (id: string) => string;
  selection: WorkflowSelection;
  familySelection: FamilySelection;
  selecting: boolean;
}) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const list = useWorkflowList<WorkflowFamily>({
    resource: 'workflows/families',
    filters,
    search,
    instanceId,
  });
  const families = (list.tableProps.dataSource ?? []) as WorkflowFamily[];

  const onEffect = (family: WorkflowFamily) => (effect: RowEffect) => {
    if (effect === 'expand') {
      setExpandedId((current) => toggleExpanded(current, family.id));
      return;
    }
    const { scope, rows } = selectionToggle(familySelection.keys, family);
    familySelection.onSelect(scope, rows);
  };

  return (
    <List<WorkflowFamily>
      dataSource={families}
      rowKey="id"
      loading={Boolean(list.tableProps.loading) || list.syncing}
      pagination={mobilePagination(list)}
      renderItem={(family) => (
        <List.Item style={{ padding: 0 }}>
          <MobileRow
            title={family.name}
            badges={<FamilyEnvTags family={family} />}
            expanded={expandedId === family.id}
            selecting={selecting}
            selected={familySelection.keys.includes(family.id)}
            onEffect={onEffect(family)}
          >
            <FamilyDetail
              family={family}
              instanceName={instanceName}
              selection={selection}
              selecting={selecting}
              onChange={list.refetch}
            />
          </MobileRow>
        </List.Item>
      )}
    />
  );
}

/** Résumé d'un workflow métier déplié, puis ses exemplaires par environnement. */
function FamilyDetail({
  family,
  instanceName,
  selection,
  selecting,
  onChange,
}: {
  family: WorkflowFamily;
  instanceName: (id: string) => string;
  selection: WorkflowSelection;
  selecting: boolean;
  onChange: () => void;
}) {
  const { enabled } = useEnabledModules();
  const showGroups = !enabled || enabled.includes('workflow-groups');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const onEffect = (workflow: WorkflowRow) => (effect: RowEffect) => {
    if (effect === 'expand') {
      setExpandedId((current) => toggleExpanded(current, workflow.id));
      return;
    }
    const { scope, rows } = selectionToggle(selection.ids, workflow);
    selection.onSelect(scope, rows);
  };

  const copies =
    family.missingCount > 0 || family.archivedCount > 0 ? (
      <Space size={4} wrap>
        {family.missingCount > 0 && <Tag color="volcano">{family.missingCount} absent(s) de n8n</Tag>}
        {family.archivedCount > 0 && (
          <Typography.Text type="secondary">{family.archivedCount} archivé(s)</Typography.Text>
        )}
      </Space>
    ) : null;

  return (
    <>
      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: 8 }}
        items={[
          { key: 'divergence', label: 'Écart prod', children: <FamilyDivergence family={family} /> },
          ...(copies ? [{ key: 'copies', label: 'Copies', children: copies }] : []),
          {
            key: 'instances',
            label: 'Instances',
            children: (
              <Space size={4} wrap>
                {family.instanceIds.map((id) => (
                  <Tag key={id} color="geekblue">
                    {instanceName(id)}
                  </Tag>
                ))}
              </Space>
            ),
          },
          { key: 'upstream', label: 'Modifié (n8n)', children: formatDate(family.upstreamUpdatedAt) },
          { key: 'synced', label: 'Synchronisé', children: formatDate(family.updatedAt) },
        ]}
      />
      <List<WorkflowRow>
        size="small"
        bordered
        dataSource={family.members}
        rowKey="id"
        renderItem={(workflow) => (
          <List.Item style={{ padding: 0 }}>
            <WorkflowMobileItem
              workflow={workflow}
              expanded={expandedId === workflow.id}
              selecting={selecting}
              selected={selection.ids.includes(workflow.id)}
              onEffect={onEffect(workflow)}
              showInstance
              showGroups={showGroups}
              instanceName={instanceName}
              onChange={onChange}
            />
          </List.Item>
        )}
      />
    </>
  );
}
