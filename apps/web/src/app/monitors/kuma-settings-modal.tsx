'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';

interface KumaSettings {
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  source: 'db' | 'env' | 'none';
}

interface KumaSettingsFormValues {
  url: string;
  username: string;
  password?: string;
}

const SETTINGS_PATH = '/monitoring/settings/kuma';

/** Type d'alerte par source (texte : `health.monitors.settings.source.<source>`). */
const SOURCE_TYPES: Record<KumaSettings['source'], 'success' | 'info' | 'warning'> = {
  db: 'success',
  env: 'info',
  none: 'warning',
};

/** Formulaire des credentials admin Uptime Kuma (stockés en base, prioritaires sur le .env). */
export function KumaSettingsModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form] = Form.useForm<KumaSettingsFormValues>();
  const t = useTranslations('health.monitors.settings');
  const tc = useTranslations('common');
  const [settings, setSettings] = useState<KumaSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiGet<KumaSettings>(SETTINGS_PATH)
      .then((s) => {
        setSettings(s);
        form.setFieldsValue({ url: s.url ?? '', username: s.username ?? '', password: '' });
      })
      .catch((error) => message.error((error as Error).message));
  }, [open, form]);

  const test = async () => {
    const values = await form.validateFields();
    setTesting(true);
    try {
      await apiPost(`${SETTINGS_PATH}/test`, values);
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
      await apiPut(SETTINGS_PATH, values);
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
      const next = await apiDelete<KumaSettings>(SETTINGS_PATH);
      setSettings(next);
      form.setFieldsValue({ url: next.url ?? '', username: next.username ?? '', password: '' });
      message.success(t('cleared'));
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const passwordStored = settings?.hasPassword ?? false;

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          {settings?.source === 'db' && (
            <Popconfirm title={t('clearConfirm')} onConfirm={clear}>
              <Button danger>{t('clear')}</Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button onClick={test} loading={testing}>
            {t('test')}
          </Button>
          <Button type="primary" onClick={save} loading={saving}>
            {tc('save')}
          </Button>
        </Space>
      }
    >
      {settings && (
        <Alert
          type={SOURCE_TYPES[settings.source]}
          showIcon
          style={{ marginBottom: 16 }}
          message={t(`source.${settings.source}`)}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="url" label={t('url')} rules={[{ required: true, message: t('urlRequired') }]}>
          <Input placeholder={t('urlPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="username"
          label={t('username')}
          rules={[{ required: true, message: t('usernameRequired') }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('password')}
          rules={[{ required: !passwordStored, message: t('passwordRequired') }]}
          extra={passwordStored ? t('passwordKeep') : undefined}
        >
          <Input.Password autoComplete="new-password" placeholder={passwordStored ? '••••••••' : undefined} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
