'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiGet } from '../lib/api';

interface WorkflowJsonExport {
  platform: 'n8n' | 'make';
  fileName: string;
  json: string;
  workflowName: string;
  nodeCount: number;
  hasPinData: boolean;
  pinDataIncluded: boolean;
  stale: boolean;
  syncedAt: string;
}

interface Props {
  workflowId: string;
  open: boolean;
  onClose: () => void;
}

/** Ce qui se dit différemment d'une plateforme à l'autre. */
const WORDING = {
  n8n: {
    platform: 'n8n',
    title: 'JSON du workflow',
    items: 'nœud(s)',
    ready: 'Importable dans n8n, sans secrets.',
  },
  make: {
    platform: 'Make',
    title: 'Blueprint du scénario',
    items: 'module(s)',
    ready: 'Importable dans Make, sans secrets.',
  },
} as const;

/**
 * Le contenu du workflow, à copier (assistant IA, ticket) ou à télécharger pour
 * le réimporter : JSON n8n pour « Import from File », blueprint pour « Import
 * Blueprint » chez Make. Le nettoyage se fait côté API : la modale n'affiche que
 * ce qu'elle enverra, à l'octet près.
 */
export function WorkflowJsonModal({ workflowId, open, onClose }: Props) {
  const [data, setData] = useState<WorkflowJsonExport | null>(null);
  const [loading, setLoading] = useState(false);
  const [includePinData, setIncludePinData] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<WorkflowJsonExport>(`/workflows/${workflowId}/export?pinData=${includePinData ? 1 : 0}`)
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId, includePinData]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.json);
      message.success('JSON copié dans le presse-papier');
    } catch {
      // Presse-papier refusé (page non sécurisée, permission) : la sélection manuelle reste possible.
      message.error('Copie refusée par le navigateur — sélectionne le texte et copie-le à la main');
    }
  };

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = data.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const wording = WORDING[data?.platform ?? 'n8n'];
  const sizeKb = data ? Math.max(1, Math.round(data.json.length / 1024)) : 0;

  return (
    <Modal
      title={wording.title}
      open={open}
      onCancel={onClose}
      width={900}
      footer={
        <Space>
          <Button onClick={onClose}>Fermer</Button>
          <Button icon={<DownloadOutlined />} disabled={!data} onClick={download}>
            Télécharger
          </Button>
          <Button type="primary" icon={<CopyOutlined />} disabled={!data} onClick={copy}>
            Copier
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{wording.ready}</Typography.Text>
        {data?.stale && (
          <Alert
            type="warning"
            showIcon
            message="Export depuis la copie locale"
            description={`${wording.platform} n'a pas répondu (ou ne connaît plus ce workflow) : ce contenu est celui de la dernière synchro, le ${new Date(data.syncedAt).toLocaleString('fr-FR')}.`}
          />
        )}
        <Space wrap>
          {data && (
            <>
              <Tag>
                {data.nodeCount} {wording.items}
              </Tag>
              <Tag>{sizeKb} Ko</Tag>
            </>
          )}
          <Tooltip title={`Redemande le workflow à ${wording.platform}`}>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              Recharger
            </Button>
          </Tooltip>
          {data?.hasPinData && (
            <Tooltip title="Donnée d'exécution réelle.">
              <Checkbox checked={includePinData} onChange={(e) => setIncludePinData(e.target.checked)}>
                Inclure les données épinglées (pinData)
              </Checkbox>
            </Tooltip>
          )}
        </Space>
        <Spin spinning={loading}>
          {/* Texte laissé sélectionnable : repli quand le navigateur refuse le presse-papier. */}
          <pre
            style={{
              margin: 0,
              maxHeight: 420,
              overflow: 'auto',
              background: 'rgba(0,0,0,0.03)',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {data?.json ?? ''}
          </pre>
        </Spin>
      </Space>
    </Modal>
  );
}
