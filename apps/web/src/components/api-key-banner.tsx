'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, Space } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { ApiKeyHealth, apiKeyAlert } from '../lib/api-key/api-key-alert';

interface InstanceKey extends ApiKeyHealth {
  id: string;
  name: string;
}

/**
 * Un bandeau par instance dont la clé est refusée, expirée ou sous J-14. Sur la
 * liste il mène à la fiche ; sur la fiche, au formulaire où l'on remplace la clé.
 */
export function ApiKeyBanner({ instances, target }: { instances: InstanceKey[]; target: 'show' | 'edit' }) {
  const t = useTranslations('settings.apiKey');
  const locale = useLocale();
  const alerts = instances
    .map((instance) => ({ instance, alert: apiKeyAlert(instance) }))
    .filter((entry) => entry.alert !== null);
  if (alerts.length === 0) return null;

  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
      {alerts.map(({ instance, alert }) => {
        const date = instance.apiKeyExpiresAt
          ? new Date(instance.apiKeyExpiresAt).toLocaleDateString(locale)
          : '';
        return (
          <Alert
            key={instance.id}
            type={alert!.level}
            showIcon
            message={t(alert!.reason, { name: instance.name, date })}
            action={
              <Link href={`/instances/${target}/${instance.id}`}>
                {target === 'edit' ? t('replace') : t('open')}
              </Link>
            }
          />
        );
      })}
    </Space>
  );
}
