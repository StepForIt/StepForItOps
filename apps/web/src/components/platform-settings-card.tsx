'use client';

import React, { useEffect, useState } from 'react';
import { Card, Space, Switch, Typography, message } from 'antd';
import { apiGet, apiPut } from '../lib/api';

interface PlatformSettings {
  includeArchived: boolean;
  includeMissing: boolean;
}

/** Réglages transverses de la plateforme (page Modules). */
export function PlatformSettingsCard() {
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
    <Card size="small" title="Réglages généraux" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="start">
          <Switch
            checked={settings?.includeArchived ?? false}
            loading={saving || settings === null}
            onChange={(includeArchived) =>
              save(
                { includeArchived },
                includeArchived
                  ? 'Les workflows archivés sont de nouveau pris en compte'
                  : 'Les workflows archivés sont exclus partout',
              )
            }
          />
          <div>
            <Typography.Text strong>Inclure les workflows archivés</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                Tag <code>archived</code>, préfixe <code>[ARCHIVED]</code> ou archivage n8n.
              </Typography.Text>
            </div>
          </div>
        </Space>
        <Space align="start">
          <Switch
            checked={settings?.includeMissing ?? false}
            loading={saving || settings === null}
            onChange={(includeMissing) =>
              save(
                { includeMissing },
                includeMissing
                  ? 'Les workflows absents de n8n sont de nouveau affichés'
                  : 'Les workflows absents de n8n sont masqués',
              )
            }
          />
          <div>
            <Typography.Text strong>Afficher les workflows absents de n8n</Typography.Text>
            <div>
              <Typography.Text type="secondary">Supprimés dans n8n (historique conservé).</Typography.Text>
            </div>
          </div>
        </Space>
      </Space>
    </Card>
  );
}
