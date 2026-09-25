'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Popconfirm, Space, Tooltip, message } from 'antd';
import { CodeOutlined, EyeOutlined, InboxOutlined, UndoOutlined } from '@ant-design/icons';
import { apiPost } from '../../lib/api';
import { WorkflowJsonModal } from '../../components/workflow-json-modal';
import { WorkflowRow } from './workflow-row';

/**
 * Actions d'une ligne de workflow. L'archivage de la plateforme est un archivage
 * doux (tag + préfixe) ; un workflow archivé DANS n8n n'est plus modifiable par
 * l'API publique, on renvoie donc l'utilisateur vers n8n au lieu d'un bouton qui échoue.
 */
export function WorkflowActions({ workflow, onChange }: { workflow: WorkflowRow; onChange: () => void }) {
  const [jsonOpen, setJsonOpen] = React.useState(false);
  const setArchived = async (archived: boolean) => {
    try {
      await apiPost(`/workflows/${workflow.id}/${archived ? 'archive' : 'unarchive'}`);
      message.success(`« ${workflow.name} » ${archived ? 'archivé' : 'désarchivé'}`);
      onChange();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Space size={4}>
      <Tooltip title="Vue du workflow + assistant IA">
        <Link href={`/workflows/show/${workflow.id}?tab=graph`}>
          <Button size="small" icon={<EyeOutlined />}>
            Vue
          </Button>
        </Link>
      </Tooltip>
      <Button size="small" icon={<CodeOutlined />} onClick={() => setJsonOpen(true)}>
        JSON
      </Button>
      {/* Modale montée à l'ouverture seulement : une liste, c'est des dizaines de lignes. */}
      {jsonOpen && <WorkflowJsonModal workflowId={workflow.id} open onClose={() => setJsonOpen(false)} />}
      {workflow.archivedUpstream ? (
        <Tooltip title="Archivé dans n8n : à désarchiver depuis n8n">
          <Button size="small" icon={<UndoOutlined />} disabled>
            Désarchiver
          </Button>
        </Tooltip>
      ) : workflow.archived ? (
        <Tooltip title="Retire le tag et le préfixe [ARCHIVED]">
          <Button size="small" icon={<UndoOutlined />} onClick={() => setArchived(false)}>
            Désarchiver
          </Button>
        </Tooltip>
      ) : (
        <Popconfirm
          title="Archiver ce workflow ?"
          description="Tag + préfixe [ARCHIVED], rien n'est supprimé"
          okText="Archiver"
          cancelText="Annuler"
          onConfirm={() => setArchived(true)}
          disabled={workflow.missingInN8n}
        >
          <Tooltip title={workflow.missingInN8n ? "Ce workflow n'existe plus dans n8n" : undefined}>
            <Button size="small" icon={<InboxOutlined />} disabled={workflow.missingInN8n}>
              Archiver
            </Button>
          </Tooltip>
        </Popconfirm>
      )}
    </Space>
  );
}
