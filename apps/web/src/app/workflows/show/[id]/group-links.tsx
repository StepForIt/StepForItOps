'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Popover, Space, Spin, Tag, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiGet } from '../../../../lib/api';
import { useEnabledModules } from '../../../../lib/enabled-modules';
import { WorkflowRow } from '../../workflow-row';

interface GroupDetail {
  id: string;
  name: string;
  workflows: Array<{ id: string; name: string }>;
}

/**
 * Les groupes de ce workflow, à côté du sélecteur d'env. Un groupe qui ne se voit
 * que sur sa propre page s'oublie : c'est ici qu'on se rappelle que ce workflow
 * appartient à un domaine, et qu'on saute à ses voisins sans repasser par la liste.
 */
export function GroupLinks({ workflow }: { workflow: WorkflowRow }) {
  const t = useTranslations('workflowShow.groupLinks');
  const { enabled } = useEnabledModules();
  const groups = workflow.groups ?? [];

  if (groups.length === 0 || (enabled && !enabled.includes('workflow-groups'))) return null;

  return (
    <Space wrap size={4} style={{ marginTop: 8 }}>
      <Typography.Text type="secondary">
        <TeamOutlined /> {t('label', { count: groups.length })}
      </Typography.Text>
      {groups.map((group) => (
        <GroupTag key={group.id} group={group} currentId={workflow.id} />
      ))}
    </Space>
  );
}

/** Le contenu du groupe n'est chargé qu'à l'ouverture : la page en affiche souvent plusieurs. */
function GroupTag({ group, currentId }: { group: { id: string; name: string }; currentId: string }) {
  const t = useTranslations('workflowShow.groupLinks');
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (open: boolean) => {
    if (!open || detail || loading) return;
    setLoading(true);
    apiGet<GroupDetail>(`/workflow-groups/${group.id}`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  };

  const content = loading ? (
    <Spin size="small" />
  ) : detail === null ? (
    <Typography.Text type="secondary">{t('unreadable')}</Typography.Text>
  ) : (
    <Space direction="vertical" size={2} style={{ maxWidth: 320 }}>
      {detail.workflows.map((member) =>
        member.id === currentId ? (
          <Typography.Text key={member.id} strong>
            {t('here', { name: member.name })}
          </Typography.Text>
        ) : (
          <Link key={member.id} href={`/workflows/show/${member.id}`}>
            {member.name}
          </Link>
        ),
      )}
      <Link href={`/workflow-groups/edit/${group.id}`}>{t('openGroup')}</Link>
    </Space>
  );

  return (
    <Popover trigger="click" onOpenChange={load} title={group.name} content={content} placement="bottomLeft">
      <Tag color="purple" style={{ cursor: 'pointer' }}>
        {group.name}
      </Tag>
    </Popover>
  );
}
