'use client';

import React from 'react';
import { CrudFilters } from '@refinedev/core';
import { List } from 'antd';
import { useEnabledModules } from '../../../lib/enabled-modules';
import { useWorkflowList } from '../use-workflow-list';
import { WorkflowRow, WorkflowSelection } from '../workflow-row';
import { RowEffect, selectionToggle, toggleExpanded } from '../../../components/mobile/mobile-gestures';
import { WorkflowMobileItem } from './workflow-mobile-item';
import { mobilePagination } from '../../../components/mobile/mobile-pagination';

/** Vue plate sur mobile : une ligne par workflow n8n, dépliable. Même requête que `WorkflowsTable`. */
export function WorkflowsMobileList({
  filters,
  search,
  instanceId,
  showInstance,
  instanceName,
  selection,
  selecting,
}: {
  filters: CrudFilters;
  search?: string;
  instanceId: string | null;
  showInstance: boolean;
  instanceName: (id: string) => string;
  selection: WorkflowSelection;
  /** Mode sélection ouvert : le tap coche au lieu de déplier. */
  selecting: boolean;
}) {
  const { enabled } = useEnabledModules();
  const showGroups = !enabled || enabled.includes('workflow-groups');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const list = useWorkflowList<WorkflowRow>({ resource: 'workflows', filters, search, instanceId });
  const rows = (list.tableProps.dataSource ?? []) as WorkflowRow[];

  const onEffect = (workflow: WorkflowRow) => (effect: RowEffect) => {
    if (effect === 'expand') {
      setExpandedId((current) => toggleExpanded(current, workflow.id));
      return;
    }
    const { scope, rows: next } = selectionToggle(selection.ids, workflow);
    selection.onSelect(scope, next);
  };

  return (
    <List<WorkflowRow>
      dataSource={rows}
      rowKey="id"
      loading={Boolean(list.tableProps.loading) || list.syncing}
      pagination={mobilePagination(list)}
      renderItem={(workflow) => (
        <List.Item style={{ padding: 0 }}>
          <WorkflowMobileItem
            workflow={workflow}
            expanded={expandedId === workflow.id}
            selecting={selecting}
            selected={selection.ids.includes(workflow.id)}
            onEffect={onEffect(workflow)}
            showInstance={showInstance}
            showGroups={showGroups}
            instanceName={instanceName}
            onChange={list.refetch}
          />
        </List.Item>
      )}
    />
  );
}
