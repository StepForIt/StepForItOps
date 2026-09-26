'use client';

import React from 'react';
import Link from 'next/link';
import { Space, Tag, Tooltip } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { WorkflowRow } from './workflow-row';
import { LockIcon } from '../../components/workflow-lock';

/** Nom du workflow, son état d'archivage et le lien vers n8n — même rendu en vue plate et groupée. */
export function WorkflowNameCell({ workflow }: { workflow: WorkflowRow }) {
  const t = useTranslations('workflowsList.nameCell');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  return (
    <Space size={4} wrap>
      <Link href={`/workflows/show/${workflow.id}`}>{workflow.name}</Link>
      <LockIcon workflowId={workflow.id} />
      {workflow.archivedUpstream ? (
        <Tooltip title={t('archivedUpstreamTooltip')}>
          <Tag color="default">{t('archivedUpstream')}</Tag>
        </Tooltip>
      ) : (
        workflow.archived && <Tag color="default">{t('archived')}</Tag>
      )}
      {workflow.missingInN8n && (
        <Tooltip
          title={t('missingTooltip', {
            date: workflow.missingUpstreamAt
              ? new Date(workflow.missingUpstreamAt).toLocaleString(locale)
              : '?',
          })}
        >
          <Tag color="volcano">{t('missing')}</Tag>
        </Tooltip>
      )}
      <Tooltip title={tCommon('openInN8n')}>
        <a href={workflow.n8nUrl} target="_blank" rel="noopener noreferrer">
          <ExportOutlined />
        </a>
      </Tooltip>
    </Space>
  );
}
