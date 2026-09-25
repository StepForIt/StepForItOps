'use client';

import React from 'react';
import Link from 'next/link';
import { Descriptions, Space, Tag, Typography } from 'antd';
import type { DescriptionsProps } from 'antd';
import { WorkflowActions } from '../workflow-actions';
import { WorkflowNameCell } from '../workflow-name-cell';
import { DivergenceTag } from '../divergence-tag';
import { formatDate } from '../format-date';
import { WorkflowRow } from '../workflow-row';
import { useEnvColor } from '../../../lib/envs';
import { MobileRow } from '../../../components/mobile/mobile-row';
import { RowEffect } from '../../../components/mobile/mobile-gestures';

/**
 * Un workflow n8n dans la liste mobile : replié, son nom et son env ; déplié, ce
 * que montrent les colonnes du tableau desktop, puis ses actions de ligne.
 */
export function WorkflowMobileItem({
  workflow,
  expanded,
  selecting,
  selected,
  onEffect,
  showInstance,
  showGroups,
  instanceName,
  onChange,
}: {
  workflow: WorkflowRow;
  expanded: boolean;
  selecting: boolean;
  selected: boolean;
  onEffect: (effect: RowEffect) => void;
  showInstance: boolean;
  showGroups: boolean;
  instanceName: (id: string) => string;
  /** Une action de ligne est passée : la liste se recharge. */
  onChange: () => void;
}) {
  const envColor = useEnvColor();
  const none = <Typography.Text type="secondary">—</Typography.Text>;
  type Item = NonNullable<DescriptionsProps['items']>[number];
  const items = (
    [
      { key: 'name', label: 'Nom', children: <WorkflowNameCell workflow={workflow} /> },
      showInstance && {
        key: 'instance',
        label: 'Instance',
        children: <Tag color="geekblue">{instanceName(workflow.instanceId)}</Tag>,
      },
      {
        key: 'divergence',
        label: 'Écart prod',
        children: workflow.divergence ? (
          <DivergenceTag workflowId={workflow.id} divergence={workflow.divergence} />
        ) : (
          none
        ),
      },
      {
        key: 'active',
        label: 'Statut',
        children: workflow.active ? <Tag color="green">actif</Tag> : <Tag>inactif</Tag>,
      },
      showGroups && {
        key: 'groups',
        label: 'Groupe',
        children:
          workflow.groups && workflow.groups.length > 0 ? (
            <Space size={4} wrap>
              {workflow.groups.map((group) => (
                <Link key={group.id} href={`/workflow-groups/edit/${group.id}`}>
                  <Tag color="purple">{group.name}</Tag>
                </Link>
              ))}
            </Space>
          ) : (
            none
          ),
      },
      workflow.tags.length > 0 && {
        key: 'tags',
        label: 'Tags',
        children: (
          <Space size={4} wrap>
            {workflow.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ),
      },
      workflow.monitorCount > 0 && {
        key: 'monitoring',
        label: 'Monitoring',
        children: (
          <Tag color="green">
            {workflow.monitorCount} sonde{workflow.monitorCount > 1 ? 's' : ''}
          </Tag>
        ),
      },
      { key: 'upstream', label: 'Modifié (n8n)', children: formatDate(workflow.upstreamUpdatedAt) },
      { key: 'synced', label: 'Synchronisé', children: formatDate(workflow.updatedAt) },
    ] as Array<Item | false>
  ).filter((item): item is Item => Boolean(item));

  return (
    <MobileRow
      title={workflow.name}
      badges={workflow.env ? <Tag color={envColor(workflow.env)}>{workflow.env}</Tag> : <Tag>?</Tag>}
      expanded={expanded}
      selecting={selecting}
      selected={selected}
      onEffect={onEffect}
    >
      <Descriptions size="small" column={1} items={items} style={{ marginBottom: 12 }} />
      <WorkflowActions workflow={workflow} onChange={onChange} />
    </MobileRow>
  );
}
