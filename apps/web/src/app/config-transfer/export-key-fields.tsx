'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined, KeyOutlined, UnlockOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { FieldLabel } from '../../components/field-label';
import { generateExportKey } from '../../lib/export-key/export-key';

/**
 * Clé d'export d'UN téléchargement : générée ici, montrée une seule fois pour
 * être copiée, puis oubliée — rien ne la garde, ni la page, ni le navigateur,
 * ni l'API. Le fichier ne part qu'une fois la clé déclarée rangée : un fichier
 * scellé dont personne n'a la clé ne rendrait plus jamais ses secrets.
 */
export function ExportKeyModal({
  open,
  onCancel,
  onDownload,
}: {
  open: boolean;
  onCancel: () => void;
  onDownload: (key: string) => void | Promise<void>;
}) {
  const t = useTranslations('misc.configTransfer.exportKey');
  const [key, setKey] = useState('');
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Une clé neuve à chaque ouverture ; vidée à la fermeture.
  useEffect(() => {
    setKey(open ? generateExportKey() : '');
    setStored(false);
    setCopied(false);
  }, [open]);

  const copy = async () => {
    await navigator.clipboard?.writeText(key).catch(() => undefined);
    setCopied(true);
  };

  const download = async () => {
    setBusy(true);
    try {
      await onDownload(key);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <KeyOutlined />
          {t('title')}
        </Space>
      }
      onCancel={onCancel}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t('cancel')}
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!stored}
          loading={busy}
          onClick={download}
        >
          {t('download')}
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph>{t('body')}</Typography.Paragraph>
        <Typography.Text
          code
          aria-label={t('keyLabel')}
          data-testid="export-key-value"
          style={{ fontSize: 18, letterSpacing: 1, userSelect: 'all' }}
        >
          {key}
        </Typography.Text>
        <Button icon={<CopyOutlined />} onClick={copy}>
          {copied ? t('copied') : t('copy')}
        </Button>
        <Alert type="warning" showIcon message={t('once')} />
        <Checkbox checked={stored} onChange={(e) => setStored(e.target.checked)}>
          {t('stored')}
        </Checkbox>
      </Space>
    </Modal>
  );
}

/** Redemande la clé d'un fichier scellé (import, restauration). */
export function ExportKeyPrompt({
  id,
  message,
  loading,
  onSubmit,
}: {
  id: string;
  message: string;
  loading: boolean;
  onSubmit: (key: string) => void;
}) {
  const t = useTranslations('misc.configTransfer.exportKey');
  const [key, setKey] = useState('');
  const submit = () => {
    if (key) onSubmit(key);
  };
  return (
    <Alert
      type="info"
      showIcon
      icon={<UnlockOutlined />}
      message={message}
      description={
        <Space direction="vertical" style={{ width: '100%', maxWidth: 480 }}>
          <FieldLabel htmlFor={id} required>
            {t('askLabel')}
          </FieldLabel>
          <Input.Password
            id={id}
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onPressEnter={submit}
          />
          <Button type="primary" icon={<UnlockOutlined />} loading={loading} disabled={!key} onClick={submit}>
            {t('open')}
          </Button>
        </Space>
      }
    />
  );
}
