'use client';

import React from 'react';
import { Button, Checkbox, Form, Select, Space } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { useEnvOptions } from '../../../lib/envs';
import { useEnabledModules } from '../../../lib/enabled-modules';
import { useInstanceScope } from '../../../lib/instance-scope';
import { BulkEnvAction, BulkSettings } from './types';

/**
 * Ce qui vaut pour tout le lot, dit une seule fois : d'où, vers où, et les
 * options du geste. Mêmes défauts que l'écran d'un workflow seul — traverser la
 * chaîne, cascader les sous-workflows, lire les tables de la cible.
 */
export function BulkEnvSettingsForm({
  action,
  value,
  onChange,
  instances,
}: {
  action: BulkEnvAction;
  value: BulkSettings;
  onChange: (value: BulkSettings) => void;
  instances: Array<{ id: string; name: string }>;
}) {
  const envOptions = useEnvOptions();
  const { instanceName } = useInstanceScope();
  const { enabled } = useEnabledModules();
  const remoteAvailable = !enabled || enabled.includes('remote-schema');
  const [showOptions, setShowOptions] = React.useState(false);
  const set = (change: Partial<BulkSettings>) => onChange({ ...value, ...change });

  return (
    <Form layout="vertical">
      <Space wrap size="large" align="start">
        {action !== 'mark' && (
          <Form.Item label="Depuis l’env" required>
            <Select
              style={{ width: 180 }}
              options={envOptions}
              value={value.sourceEnv ?? undefined}
              onChange={(sourceEnv: string) => set({ sourceEnv })}
            />
          </Form.Item>
        )}
        <Form.Item label={action === 'mark' ? 'Déclarer en' : 'Vers l’env'} required>
          <Select
            style={{ width: 180 }}
            options={envOptions.filter((option) => option.value !== value.sourceEnv)}
            value={value.targetEnv || undefined}
            onChange={(targetEnv: string) => set({ targetEnv })}
          />
        </Form.Item>
        {action === 'promote' && (
          <Form.Item
            label="Instance (si l’env n’existe pas)"
            tooltip="Une famille qui a déjà l’env cible est promue là où il vit."
          >
            <Select
              style={{ width: 240 }}
              allowClear
              placeholder="Même instance"
              options={instances.map((instance) => ({
                value: instance.id,
                label: instance.name || instanceName(instance.id),
              }))}
              value={value.fallbackInstanceId}
              onChange={(fallbackInstanceId?: string) => set({ fallbackInstanceId })}
            />
          </Form.Item>
        )}
      </Space>
      <Button
        type="link"
        size="small"
        style={{ paddingLeft: 0 }}
        icon={showOptions ? <DownOutlined /> : <RightOutlined />}
        onClick={() => setShowOptions(!showOptions)}
      >
        Options
      </Button>
      <Space direction="vertical" size={2} style={{ display: showOptions ? undefined : 'none' }}>
        {action === 'promote' && (
          <Checkbox checked={value.throughChain} onChange={(e) => set({ throughChain: e.target.checked })}>
            Via envs intermédiaires
          </Checkbox>
        )}
        {action !== 'mark' && (
          <Checkbox checked={value.cascade} onChange={(e) => set({ cascade: e.target.checked })}>
            Créer les sous-workflows manquants
          </Checkbox>
        )}
        {action === 'promote' && remoteAvailable && (
          <Checkbox checked={value.checkRemote} onChange={(e) => set({ checkRemote: e.target.checked })}>
            Vérifier les tables distantes
          </Checkbox>
        )}
        {action === 'promote' && (
          <Checkbox
            checked={value.publishLikeSource}
            onChange={(e) => set({ publishLikeSource: e.target.checked })}
          >
            Publier comme la source
          </Checkbox>
        )}
        {action === 'mark' && (
          <Checkbox checked={value.rename} onChange={(e) => set({ rename: e.target.checked })}>
            Suffixer le nom
          </Checkbox>
        )}
      </Space>
    </Form>
  );
}
