'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { Table } from '../../components/resizable-table';
import { useInstanceScope } from '../../lib/instance-scope';
import { GroupDuplicateModal } from '../../components/group-duplicate-modal';
import { useTranslations } from 'next-intl';

interface GroupRow {
  id: string;
  name: string;
  instanceId: string;
  instanceName: string;
  workflows: Array<{ id: string; name: string }>;
}

export default function WorkflowGroupsList() {
  const t = useTranslations('settings.workflowGroups');
  const tc = useTranslations('common');
  const { scope } = useInstanceScope();
  const [duplicating, setDuplicating] = useState<GroupRow | null>(null);
  const { tableProps, sorters } = useTable<GroupRow>({
    resource: 'workflow-groups',
    filters: {
      permanent: scope ? [{ field: 'instanceId', operator: 'eq', value: scope }] : [],
    },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });

  return (
    <List headerButtons={<CreateButton />}>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="name"
          title={t('group')}
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
        />
        <Table.Column
          dataIndex="instanceName"
          title={tc('columns.instance')}
          sorter
          defaultSortOrder={getDefaultSortOrder('instanceName', sorters)}
          render={(name: string) => <Tag>{name}</Tag>}
        />
        <Table.Column<GroupRow>
          dataIndex="workflows"
          title={t('workflows')}
          render={(workflows: GroupRow['workflows']) =>
            workflows.length === 0 ? (
              <Typography.Text type="secondary">{t('none')}</Typography.Text>
            ) : (
              <Space size={4} wrap>
                {workflows.slice(0, 6).map((w) => (
                  <Link key={w.id} href={`/workflows/show/${w.id}`}>
                    <Tag>{w.name}</Tag>
                  </Link>
                ))}
                {workflows.length > 6 && <Tag>+{workflows.length - 6}</Tag>}
              </Space>
            )
          }
        />
        <Table.Column<GroupRow>
          title={tc('columns.actions')}
          className="row-actions"
          render={(_, record) => (
            <Space>
              <Tooltip title={t('duplicateTooltip')}>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  disabled={record.workflows.length === 0}
                  onClick={() => setDuplicating(record)}
                />
              </Tooltip>
              <EditButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
      {duplicating && (
        <GroupDuplicateModal
          groupId={duplicating.id}
          groupName={duplicating.name}
          open
          onClose={() => setDuplicating(null)}
        />
      )}
    </List>
  );
}
