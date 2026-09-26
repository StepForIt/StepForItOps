'use client';

import React, { useEffect, useState } from 'react';
import { Card, Select, Space, Switch, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPut } from '../lib/api';

interface PlatformSettings {
  includeArchived: boolean;
  includeMissing: boolean;
  defaultLocale: 'fr' | 'en';
}

/** Réglages transverses de la plateforme (page Modules). */
export function PlatformSettingsCard() {
  const t = useTranslations('settings.platformSettings');
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<PlatformSettings>('/settings/platform')
      .then(setSettings)
      .catch((error) => message.error((error as Error).message));
  }, []);

  const save = async (patch: Partial<PlatformSettings>, done: string) => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await apiPut<PlatformSettings>('/settings/platform', { ...settings, ...patch }));
      message.success(done);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" title={t('title')} style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="start">
          <Switch
            checked={settings?.includeArchived ?? false}
            loading={saving || settings === null}
            onChange={(includeArchived) =>
              save({ includeArchived }, includeArchived ? t('archivedIncluded') : t('archivedExcluded'))
            }
          />
          <div>
            <Typography.Text strong>{t('includeArchived')}</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                {t.rich('includeArchivedHint', { code: (chunks) => <code>{chunks}</code> })}
              </Typography.Text>
            </div>
          </div>
        </Space>
        <Space align="start">
          <Switch
            checked={settings?.includeMissing ?? false}
            loading={saving || settings === null}
            onChange={(includeMissing) =>
              save({ includeMissing }, includeMissing ? t('missingShown') : t('missingHidden'))
            }
          />
          <div>
            <Typography.Text strong>{t('includeMissing')}</Typography.Text>
            <div>
              <Typography.Text type="secondary">{t('includeMissingHint')}</Typography.Text>
            </div>
          </div>
        </Space>
        <Space align="start">
          <Select
            size="small"
            style={{ width: 110 }}
            value={settings?.defaultLocale}
            loading={saving || settings === null}
            disabled={saving || settings === null}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(defaultLocale) => save({ defaultLocale }, t('defaultLocaleSaved'))}
          />
          <div>
            <Typography.Text strong>{t('defaultLocale')}</Typography.Text>
            <div>
              <Typography.Text type="secondary">{t('defaultLocaleHint')}</Typography.Text>
            </div>
          </div>
        </Space>
      </Space>
    </Card>
  );
}
