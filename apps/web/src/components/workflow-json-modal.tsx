'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
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

/** Le nom affiché de la plateforme ; le reste de ce qui en dépend est un `select` des messages. */
const PLATFORM_NAME = { n8n: 'n8n', make: 'Make' } as const;

/**
 * Le contenu du workflow, à copier (assistant IA, ticket) ou à télécharger pour
 * le réimporter : JSON n8n pour « Import from File », blueprint pour « Import
 * Blueprint » chez Make. Le nettoyage se fait côté API : la modale n'affiche que
 * ce qu'elle enverra, à l'octet près.
 */
export function WorkflowJsonModal({ workflowId, open, onClose }: Props) {
  const t = useTranslations('reviewTools.workflowJson');
  const tCommon = useTranslations('common');
  const locale = useLocale();
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
      message.success(t('copied'));
    } catch {
      // Presse-papier refusé (page non sécurisée, permission) : la sélection manuelle reste possible.
      message.error(t('copyRefused'));
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

  const platform = data?.platform ?? 'n8n';
  const platformName = PLATFORM_NAME[platform];
  const sizeKb = data ? Math.max(1, Math.round(data.json.length / 1024)) : 0;

  return (
    <Modal
      title={platform === 'make' ? t('titleMake') : t('titleN8n')}
      open={open}
      onCancel={onClose}
      width={900}
      footer={
        <Space>
          <Button onClick={onClose}>{tCommon('close')}</Button>
          <Button icon={<DownloadOutlined />} disabled={!data} onClick={download}>
            {tCommon('download')}
          </Button>
          <Button type="primary" icon={<CopyOutlined />} disabled={!data} onClick={copy}>
            {t('copy')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('ready', { platform: platformName })}</Typography.Text>
        {data?.stale && (
          <Alert
            type="warning"
            showIcon
            message={t('staleTitle')}
            description={t('staleDescription', {
              platform: platformName,
              date: new Date(data.syncedAt).toLocaleString(locale),
            })}
          />
        )}
        <Space wrap>
          {data && (
            <>
              <Tag>
                {platform === 'make'
                  ? t('itemsMake', { count: data.nodeCount })
                  : t('itemsN8n', { count: data.nodeCount })}
              </Tag>
              <Tag>{t('size', { size: sizeKb })}</Tag>
            </>
          )}
          <Tooltip title={t('reloadTooltip', { platform: platformName })}>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              {t('reload')}
            </Button>
          </Tooltip>
          {data?.hasPinData && (
            <Tooltip title={t('pinDataTooltip')}>
              <Checkbox checked={includePinData} onChange={(e) => setIncludePinData(e.target.checked)}>
                {t('includePinData')}
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
