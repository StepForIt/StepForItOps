'use client';

import React from 'react';
import Link from 'next/link';
import { Space, Tag, Tooltip } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { WorkflowRow } from './workflow-row';
import { LockIcon } from '../../components/workflow-lock';

/** Nom du workflow, son état d'archivage et le lien vers n8n — même rendu en vue plate et groupée. */
export function WorkflowNameCell({ workflow }: { workflow: WorkflowRow }) {
  return (
    <Space size={4} wrap>
      <Link href={`/workflows/show/${workflow.id}`}>{workflow.name}</Link>
      <LockIcon workflowId={workflow.id} />
      {workflow.archivedUpstream ? (
        <Tooltip title="Archivé dans n8n : l'API publique ne le renvoie plus dans la liste, la plateforme le retrouve à l'unité à chaque synchro">
          <Tag color="default">archivé dans n8n</Tag>
        </Tooltip>
      ) : (
        workflow.archived && <Tag color="default">archivé</Tag>
      )}
      {workflow.missingInN8n && (
        <Tooltip
          title={`n8n ne connaît plus ce workflow depuis le ${
            workflow.missingUpstreamAt ? new Date(workflow.missingUpstreamAt).toLocaleString('fr-FR') : '?'
          } — supprimé côté n8n. Rien n'a été effacé ici : versions et historique restent consultables.`}
        >
          <Tag color="volcano">absent de n8n</Tag>
        </Tooltip>
      )}
      <Tooltip title="Ouvrir dans n8n">
        <a href={workflow.n8nUrl} target="_blank" rel="noopener noreferrer">
          <ExportOutlined />
        </a>
      </Tooltip>
    </Space>
  );
}
