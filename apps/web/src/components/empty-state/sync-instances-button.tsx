'use client';

import React, { useState } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import { useInstances } from './use-instances';

interface SyncResult {
  synced: number;
}

/**
 * Synchronise sur place l'instance visée (scope ou filtre), sinon toutes, une par une :
 * une instance injoignable n'empêche pas les autres d'arriver, et son nom est dit dans
 * l'erreur. C'est le geste qui remplit une console neuve, sans passer par Paramètres.
 */
export function SyncInstancesButton({
  instanceId,
  onSynced,
  primary = true,
}: {
  instanceId: string | null;
  onSynced: () => void;
  primary?: boolean;
}) {
  const t = useTranslations('common.emptyState.sync');
  const { instances } = useInstances();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [synced, setSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = instanceId ? instances.filter((instance) => instance.id === instanceId) : instances;

  const sync = async () => {
    setError(null);
    setSynced(null);
    let total = 0;
    const failures: string[] = [];
    for (const [index, instance] of targets.entries()) {
      setProgress({ done: index, total: targets.length });
      try {
        total += (await apiPost<SyncResult>(`/workflows/sync/${instance.id}`)).synced;
      } catch (e) {
        failures.push(`${instance.name} : ${(e as Error).message}`);
      }
    }
    setProgress(null);
    setSynced(total);
    if (failures.length > 0) setError(failures.join('\n'));
    onSynced();
  };

  return (
    <Space direction="vertical" align="center" size={8}>
      <Button
        type={primary ? 'primary' : 'default'}
        icon={<CloudDownloadOutlined />}
        loading={progress !== null}
        onClick={sync}
        disabled={targets.length === 0}
      >
        {progress && progress.total > 1
          ? t('progress', { done: progress.done + 1, total: progress.total })
          : targets.length === 1
            ? t('one', { name: targets[0].name })
            : t('all', { count: targets.length })}
      </Button>
      {synced !== null && !error && (
        <Typography.Text type="secondary">
          {synced > 0 ? t('syncedSome', { count: synced }) : t('syncedNone')}
        </Typography.Text>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={t('failed')}
          description={<span style={{ whiteSpace: 'pre-line' }}>{error}</span>}
          style={{ textAlign: 'left', maxWidth: 520 }}
        />
      )}
    </Space>
  );
}
