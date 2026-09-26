'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, List, Modal, Typography } from 'antd';
import {
  CloudDownloadOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import { BRAND } from '../../lib/brand/colors';

interface SyncResult {
  synced: number;
  changed: number;
}

const STEPS = [
  { icon: <CloudDownloadOutlined />, key: 'read' },
  { icon: <DatabaseOutlined />, key: 'mirror' },
  { icon: <HistoryOutlined />, key: 'version' },
] as const;

/** Explique ce que fait la synchro avant de la lancer, puis affiche le résultat. */
export function SyncModal({
  instanceId,
  instanceName,
  onClose,
}: {
  instanceId: string | null;
  instanceName?: string;
  onClose: () => void;
}) {
  const t = useTranslations('settings.syncModal');
  const tc = useTranslations('common');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [instanceId]);

  const run = async () => {
    if (!instanceId) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await apiPost<SyncResult>(`/workflows/sync/${instanceId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title={t('title', { name: instanceName ?? '' })}
      open={instanceId !== null}
      onCancel={onClose}
      width={640}
      footer={
        result ? (
          <Button type="primary" onClick={onClose}>
            {tc('close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            <Button type="primary" loading={running} onClick={run}>
              {t('sync')}
            </Button>
          </>
        )
      }
    >
      <Alert
        type="success"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={t('readOnly')}
        description={t('readOnlyHint')}
        style={{ marginBottom: 16 }}
      />

      <Typography.Text strong>{t('whatHappens')}</Typography.Text>
      <List
        size="small"
        dataSource={[...STEPS]}
        renderItem={(step) => (
          <List.Item>
            <List.Item.Meta
              avatar={<span style={{ fontSize: 18, color: BRAND.primary }}>{step.icon}</span>}
              title={t(`steps.${step.key}.title`)}
              description={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`steps.${step.key}.detail`)}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        {t('note')}
      </Typography.Paragraph>

      {error && <Alert type="error" showIcon message={t('failed')} description={error} />}
      {result && (
        <Alert
          type="success"
          showIcon
          message={t('synced', { count: result.synced })}
          description={result.changed > 0 ? t('changed', { count: result.changed }) : t('unchanged')}
        />
      )}
    </Modal>
  );
}
