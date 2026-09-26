'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Segmented, Space, Switch, Tag, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api';

export interface AiProviderSettings {
  id: string;
  label: string;
  defaultModel: string;
  envKey: string;
  hasKey: boolean;
  model: string | null;
  source: 'db' | 'env' | 'none';
}

export interface AiSettings {
  /** Fournisseur qui sert les appels. */
  provider: string;
  providers: AiProviderSettings[];
  /** État du fournisseur actif, repris à plat. */
  hasKey: boolean;
  model: string | null;
  source: 'db' | 'env' | 'none';
}

interface AiSettingsFormValues {
  apiKey?: string;
  model?: string;
  activate?: boolean;
}

const SETTINGS_PATH = '/settings/ai';

/**
 * Clé et modèle par fournisseur, plus le choix de celui qui sert les appels. Les
 * deux clés cohabitent : basculer parce que l'un est plafonné ne coûte pas une
 * ressaisie.
 */
export function AiSettingsModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('settings.aiSettings');
  const tc = useTranslations('common');
  const [form] = Form.useForm<AiSettingsFormValues>();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = settings?.providers.find((p) => p.id === edited) ?? null;
  const isActive = Boolean(current && settings && current.id === settings.provider);

  /** Recharge les champs sur le fournisseur affiché ; la clé n'est jamais renvoyée. */
  const showProvider = (next: AiSettings, providerId: string) => {
    const provider = next.providers.find((p) => p.id === providerId);
    setEdited(providerId);
    form.setFieldsValue({
      apiKey: '',
      model: provider?.model ?? '',
      activate: providerId === next.provider,
    });
  };

  useEffect(() => {
    if (!open) return;
    apiGet<AiSettings>(SETTINGS_PATH)
      .then((s) => {
        setSettings(s);
        showProvider(s, s.provider);
      })
      .catch((error) => message.error((error as Error).message));
    // showProvider ne dépend que de `form`, stable pour la durée du modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form]);

  const test = async () => {
    const values = await form.validateFields();
    setTesting(true);
    try {
      await apiPost(`${SETTINGS_PATH}/test`, { ...values, provider: edited });
      message.success(t('testOk'));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const next = await apiPut<AiSettings>(SETTINGS_PATH, { ...values, provider: edited });
      setSettings(next);
      message.success(t('saved'));
      onChanged();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      const next = await apiDelete<AiSettings>(`${SETTINGS_PATH}?provider=${edited}`);
      setSettings(next);
      showProvider(next, edited ?? next.provider);
      message.success(t('cleared'));
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const keyStored = current?.hasKey ?? false;

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          {current?.source === 'db' && (
            <Popconfirm title={t('clearConfirm')} onConfirm={clear}>
              <Button danger>{t('clear')}</Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button onClick={test} loading={testing}>
            {t('testKey')}
          </Button>
          <Button type="primary" onClick={save} loading={saving}>
            {tc('save')}
          </Button>
        </Space>
      }
    >
      {settings && (
        <>
          <Segmented
            block
            style={{ marginBottom: 16 }}
            value={edited ?? settings.provider}
            onChange={(value) => showProvider(settings, String(value))}
            options={settings.providers.map((provider) => ({
              value: provider.id,
              label: (
                <span>
                  {provider.label}
                  {provider.id === settings.provider && (
                    <Tag color="green" style={{ marginLeft: 8 }}>
                      {t('active')}
                    </Tag>
                  )}
                </span>
              ),
            }))}
          />
          {current?.source === 'none' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('noKey', { provider: current.label })}
            />
          )}
        </>
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="apiKey"
          label={t('apiKey', { provider: current?.label ?? '' }).trim()}
          rules={[{ required: !keyStored, message: t('apiKeyRequired') }]}
          extra={keyStored ? t('keepKey') : undefined}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={keyStored ? '••••••••' : edited === 'mistral' ? '…' : 'sk-ant-…'}
          />
        </Form.Item>
        <Form.Item name="model" label={t('model')}>
          <Input placeholder={current?.defaultModel} />
        </Form.Item>
        {/* Masqué mais enregistré : la valeur `true` du fournisseur actif part toujours. */}
        <Form.Item name="activate" label={t('activate')} valuePropName="checked" hidden={isActive}>
          <Switch disabled={isActive} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
