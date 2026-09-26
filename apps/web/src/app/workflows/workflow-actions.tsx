'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Popconfirm, Space, Tooltip, message } from 'antd';
import { CodeOutlined, EyeOutlined, InboxOutlined, UndoOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import { WorkflowJsonModal } from '../../components/workflow-json-modal';
import { WorkflowRow } from './workflow-row';

/**
 * Actions d'une ligne de workflow. L'archivage de la plateforme est un archivage
 * doux (tag + préfixe) ; un workflow archivé DANS n8n n'est plus modifiable par
 * l'API publique, on renvoie donc l'utilisateur vers n8n au lieu d'un bouton qui échoue.
 */
export function WorkflowActions({ workflow, onChange }: { workflow: WorkflowRow; onChange: () => void }) {
  const t = useTranslations('workflowsList.actions');
  const tCommon = useTranslations('common');
  const [jsonOpen, setJsonOpen] = React.useState(false);
  const setArchived = async (archived: boolean) => {
    try {
      await apiPost(`/workflows/${workflow.id}/${archived ? 'archive' : 'unarchive'}`);
      message.success(
        archived
          ? t('archivedToast', { name: workflow.name })
          : t('unarchivedToast', { name: workflow.name }),
      );
      onChange();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Space size={4}>
      <Tooltip title={t('viewTooltip')}>
        <Link href={`/workflows/show/${workflow.id}?tab=graph`}>
          <Button size="small" icon={<EyeOutlined />}>
            {t('view')}
          </Button>
        </Link>
      </Tooltip>
      <Button size="small" icon={<CodeOutlined />} onClick={() => setJsonOpen(true)}>
        JSON
      </Button>
      {/* Modale montée à l'ouverture seulement : une liste, c'est des dizaines de lignes. */}
      {jsonOpen && <WorkflowJsonModal workflowId={workflow.id} open onClose={() => setJsonOpen(false)} />}
      {workflow.archivedUpstream ? (
        <Tooltip title={t('archivedUpstreamTooltip')}>
          <Button size="small" icon={<UndoOutlined />} disabled>
            {t('unarchive')}
          </Button>
        </Tooltip>
      ) : workflow.archived ? (
        <Tooltip title={t('unarchiveTooltip')}>
          <Button size="small" icon={<UndoOutlined />} onClick={() => setArchived(false)}>
            {t('unarchive')}
          </Button>
        </Tooltip>
      ) : (
        <Popconfirm
          title={t('archiveConfirmTitle')}
          description={t('archiveConfirmDescription')}
          okText={t('archive')}
          cancelText={tCommon('cancel')}
          onConfirm={() => setArchived(true)}
          disabled={workflow.missingInN8n}
        >
          <Tooltip title={workflow.missingInN8n ? t('missingTooltip') : undefined}>
            <Button size="small" icon={<InboxOutlined />} disabled={workflow.missingInN8n}>
              {t('archive')}
            </Button>
          </Tooltip>
        </Popconfirm>
      )}
    </Space>
  );
}
