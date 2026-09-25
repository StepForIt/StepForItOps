'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, message } from 'antd';
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

const SOURCE_LABELS: Record<KumaSettings['source'], { type: 'success' | 'info' | 'warning'; text: string }> =
  {
    db: { type: 'success', text: 'Credentials actifs : réglages enregistrés en base.' },
    env: { type: 'info', text: "Credentials actifs : variables d'env KUMA_* du .env de l'API." },
    none: { type: 'warning', text: 'Aucun credential Kuma : renseigne le formulaire ci-dessous.' },
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
      message.success('Connexion Uptime Kuma OK');
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
      message.success('Réglages Kuma enregistrés');
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
      message.success("Réglages supprimés : retour aux variables d'env");
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const passwordStored = settings?.hasPassword ?? false;

  return (
    <Modal
      title="Réglages Uptime Kuma"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          {settings?.source === 'db' && (
            <Popconfirm title="Supprimer les réglages en base et revenir au .env ?" onConfirm={clear}>
              <Button danger>Revenir au .env</Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button onClick={test} loading={testing}>
            Tester la connexion
          </Button>
          <Button type="primary" onClick={save} loading={saving}>
            Enregistrer
          </Button>
        </Space>
      }
    >
      {settings && (
        <Alert
          type={SOURCE_LABELS[settings.source].type}
          showIcon
          style={{ marginBottom: 16 }}
          message={SOURCE_LABELS[settings.source].text}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="url" label="URL Uptime Kuma" rules={[{ required: true, message: 'URL requise' }]}>
          <Input placeholder="https://kuma.exemple.fr" />
        </Form.Item>
        <Form.Item
          name="username"
          label="Utilisateur"
          rules={[{ required: true, message: 'Utilisateur requis' }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mot de passe"
          rules={[{ required: !passwordStored, message: 'Mot de passe requis' }]}
          extra={passwordStored ? 'Laisser vide pour conserver le mot de passe enregistré.' : undefined}
        >
          <Input.Password autoComplete="new-password" placeholder={passwordStored ? '••••••••' : undefined} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
