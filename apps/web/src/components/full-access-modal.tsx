'use client';

import React, { useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Space, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { FullAccessOutcome } from '../lib/full-access/full-access-prompt';

interface FullAccessModalProps {
  open: boolean;
  /** Un seul chemin de sortie, quelle que soit la façon de fermer : rien ne se perd derrière. */
  onOutcome: (outcome: FullAccessOutcome) => void;
  busy?: boolean;
}

/**
 * « Accès complet à cette instance » : le compte propriétaire n8n, fortement
 * recommandé, jamais imposé. Trois issues et pas une de plus — avec le compte,
 * sans (en cochant éventuellement « ne plus me demander »), ou fermée (Échap,
 * croix), qui vaut « sans » et sans refus. Le piège du focus et Échap viennent
 * de la modale antd, comme partout dans la console.
 */
export function FullAccessModal({ open, onOutcome, busy }: FullAccessModalProps) {
  const t = useTranslations('settings.fullAccess');
  const [form] = Form.useForm<{ n8nEmail: string; n8nPassword: string }>();
  const [dismiss, setDismiss] = useState(false);

  const saveWith = async () => {
    const values = await form.validateFields();
    onOutcome({ kind: 'with', n8nEmail: values.n8nEmail.trim(), n8nPassword: values.n8nPassword });
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <SafetyCertificateOutlined />
          {t('title')}
        </Space>
      }
      onCancel={() => onOutcome({ kind: 'closed' })}
      maskClosable={false}
      destroyOnHidden
      afterClose={() => setDismiss(false)}
      footer={
        <Space>
          <Button onClick={() => onOutcome({ kind: 'without', dismiss })} disabled={busy}>
            {t('continueWithout')}
          </Button>
          <Button type="primary" onClick={saveWith} loading={busy}>
            {t('saveWith')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph>{t('intro')}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={saveWith}>
        <Form.Item label={t('email')} name="n8nEmail" rules={[{ required: true }, { type: 'email' }]}>
          <Input autoFocus autoComplete="off" placeholder="admin@mondomaine.tld" />
        </Form.Item>
        <Form.Item label={t('password')} name="n8nPassword" rules={[{ required: true }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('storage')}
      </Typography.Paragraph>
      <Checkbox checked={dismiss} onChange={(event) => setDismiss(event.target.checked)}>
        {t('dontAskAgain')}
      </Checkbox>
    </Modal>
  );
}
