'use client';

import React, { useEffect, useState } from 'react';
import { Card, Select, Space, Switch, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPut } from '../lib/api';
import { useEnabledModules } from '../lib/enabled-modules';

interface CredentialCheckSettings {
  enabled: boolean;
  accessEveryHours: number;
  paidAccessEveryHours: number;
  creditEveryHours: number;
}

type Rhythm = 'accessEveryHours' | 'paidAccessEveryHours' | 'creditEveryHours';

/** Fréquences proposées, en heures. Une valeur déjà enregistrée hors de cette liste reste affichée. */
const PRESETS: Record<Rhythm, number[]> = {
  accessEveryHours: [1, 6, 12, 24, 48, 168],
  paidAccessEveryHours: [24, 72, 168, 336, 720],
  creditEveryHours: [24, 72, 168, 336, 720],
};

/**
 * Fréquences du test automatique des credentials IA (page Modules). Trois rythmes parce que
 * trois coûts : l'accès est gratuit chez la plupart des fournisseurs, payant chez Perplexity
 * (un appel d'un jeton), et le crédit génère toujours un appel.
 */
export function CredentialCheckSettingsCard() {
  const t = useTranslations('settings.credentialCheckSettings');
  const { enabled: enabledModules } = useEnabledModules();
  const [settings, setSettings] = useState<CredentialCheckSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const moduleOn = enabledModules?.includes('credential-check') ?? false;

  useEffect(() => {
    if (!moduleOn) return;
    apiGet<CredentialCheckSettings>('/credential-check/settings')
      .then(setSettings)
      .catch((error) => message.error((error as Error).message));
  }, [moduleOn]);

  if (!moduleOn) return null;

  const save = async (patch: Partial<CredentialCheckSettings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(
        await apiPut<CredentialCheckSettings>('/credential-check/settings', { ...settings, ...patch }),
      );
      message.success(t('saved'));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hoursLabel = (hours: number) =>
    hours % 24 === 0 ? t('days', { count: hours / 24 }) : t('hours', { count: hours });

  const rhythm = (key: Rhythm) => {
    const current = settings?.[key];
    const values =
      current && !PRESETS[key].includes(current)
        ? [...PRESETS[key], current].sort((a, b) => a - b)
        : PRESETS[key];
    return (
      <Space align="start" key={key}>
        <Select
          aria-label={t(`${key}.label`)}
          size="small"
          style={{ width: 130 }}
          value={current}
          loading={saving || settings === null}
          disabled={saving || settings === null || !settings.enabled}
          options={values.map((hours) => ({ value: hours, label: hoursLabel(hours) }))}
          onChange={(value) => save({ [key]: value })}
        />
        <div>
          <Typography.Text strong>{t(`${key}.label`)}</Typography.Text>
          <div>
            <Typography.Text type="secondary">{t(`${key}.hint`)}</Typography.Text>
          </div>
        </div>
      </Space>
    );
  };

  return (
    <Card size="small" title={t('title')} style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="start">
          <Switch
            aria-label={t('enabled')}
            checked={settings?.enabled ?? false}
            loading={saving || settings === null}
            onChange={(enabled) => save({ enabled })}
          />
          <div>
            <Typography.Text strong>{t('enabled')}</Typography.Text>
            <div>
              <Typography.Text type="secondary">{t('enabledHint')}</Typography.Text>
            </div>
          </div>
        </Space>
        {rhythm('accessEveryHours')}
        {rhythm('paidAccessEveryHours')}
        {rhythm('creditEveryHours')}
      </Space>
    </Card>
  );
}
