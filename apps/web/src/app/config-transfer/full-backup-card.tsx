'use client';

import React, { useState } from 'react';
import { Alert, Button, Card, Popconfirm, Space, Tag, Typography, Upload, message } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { CloudDownloadOutlined, InboxOutlined, WarningOutlined } from '@ant-design/icons';
import { Table } from '../../components/resizable-table';
import { API_URL, apiPost, errorFromBody } from '../../lib/api';
import { isSealedBackupHead } from '../../lib/export-key/export-key';
import { ExportKeyModal, ExportKeyPrompt } from './export-key-fields';

interface RestorePreview {
  uploadId: string;
  exportedAt: string;
  schema: string | null;
  currentSchema: string | null;
  tables: { table: string; inFile: number; current: number }[];
  totalRows: number;
  warnings: string[];
}

interface RestoreResult {
  restoredRows: number;
  tables: { table: string; rows: number }[];
  warnings: string[];
}

const UPLOAD_PATH = '/config-transfer/restore/upload';
const BACKUP_PATH = '/config-transfer/backup';

/**
 * Télécharge par un formulaire POST et non par `fetch` : le navigateur écrit la
 * réponse en flux sur le disque (des centaines de Mo ne passent pas par la
 * mémoire de la page), et la clé voyage dans le corps, jamais dans l'URL.
 */
function submitBackupForm(exportKey: string): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${API_URL}${BACKUP_PATH}`;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'exportKey';
  input.value = exportKey;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/**
 * Sauvegarde COMPLÈTE, à côté de l'export de configuration : toutes les tables,
 * historique compris. Le fichier peut peser des centaines de Mo : il se
 * télécharge par un formulaire (le navigateur l'écrit en flux) et se téléverse
 * brut, jamais relu en mémoire ici — seuls ses 8 premiers octets, pour savoir
 * s'il est scellé par une clé d'export.
 */
export function FullBackupCard({ exportEnabled }: { exportEnabled: boolean | null }) {
  const t = useTranslations('misc.configTransfer.backup');
  const tRoot = useTranslations('misc.configTransfer');
  const locale = useLocale();
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  /** Sauvegarde scellée en attente de sa clé. */
  const [sealedFile, setSealedFile] = useState<File | null>(null);

  const download = (exportKey: string) => {
    submitBackupForm(exportKey);
    setKeyModalOpen(false);
  };

  const onFile = (file: File) => {
    setPreview(null);
    setResult(null);
    setSealedFile(null);
    setFileName(file.name);
    void file
      .slice(0, 8)
      .arrayBuffer()
      .then((head) => {
        if (isSealedBackupHead(new Uint8Array(head))) setSealedFile(file);
        else upload(file, null);
      });
    return false;
  };

  const upload = (file: File, key: string | null) => {
    setUploading(true);
    fetch(`${API_URL}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        // En-tête : le corps est le fichier lui-même.
        ...(key ? { 'x-export-key': key } : {}),
      },
      body: file,
    })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) throw errorFromBody(UPLOAD_PATH, response.status, text);
        setSealedFile(null);
        setPreview(JSON.parse(text) as RestorePreview);
      })
      .catch((error: Error) => message.error(t('toast.refused', { error: error.message })))
      .finally(() => setUploading(false));
  };

  const restore = async () => {
    if (!preview) return;
    setRestoring(true);
    try {
      const done = await apiPost<RestoreResult>(`/config-transfer/restore/${preview.uploadId}/apply`, {
        confirm: true,
      });
      setResult(done);
      setPreview(null);
      message.success(t('toast.restored'));
    } catch (error) {
      message.error(t('toast.failed', { error: (error as Error).message }));
    } finally {
      setRestoring(false);
    }
  };

  const warnings = (list: string[]) =>
    list.length > 0 ? (
      <Alert
        type="warning"
        showIcon
        message={tRoot('warnings')}
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {list.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        }
      />
    ) : null;

  return (
    <Card title={t('title')}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('intro')}</Typography.Text>

        {exportEnabled === true && (
          <>
            <Alert type="info" showIcon message={t('secretsWarning')} />
            <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setKeyModalOpen(true)}>
              {t('download')}
            </Button>
            <ExportKeyModal
              open={keyModalOpen}
              onCancel={() => setKeyModalOpen(false)}
              onDownload={download}
            />
          </>
        )}
        {exportEnabled === false && <Alert type="info" showIcon message={t('downloadDisabled')} />}

        <Typography.Title level={5} style={{ marginTop: 16 }}>
          {t('restoreTitle')}
        </Typography.Title>
        <Upload.Dragger
          id="backup-restore-file"
          accept=".gz,.sealed,application/gzip,application/octet-stream"
          showUploadList={false}
          beforeUpload={onFile}
          disabled={uploading || restoring}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{uploading ? t('uploading') : t('drop')}</p>
          <p className="ant-upload-hint">{t('dropHint')}</p>
        </Upload.Dragger>

        {sealedFile && (
          <ExportKeyPrompt
            id="backup-restore-key"
            message={tRoot('exportKey.sealedBackup')}
            loading={uploading}
            onSubmit={(key) => upload(sealedFile, key)}
          />
        )}

        {preview && (
          <>
            <Alert
              type="error"
              showIcon
              icon={<WarningOutlined />}
              message={t('preview', {
                file: fileName,
                date: new Date(preview.exportedAt).toLocaleString(locale),
                rows: preview.totalRows,
              })}
              description={t('replaceWarning')}
            />
            <Table
              dataSource={preview.tables.map((row) => ({ key: row.table, ...row }))}
              pagination={false}
              size="small"
              columns={[
                { dataIndex: 'table', title: t('columns.table') },
                {
                  dataIndex: 'current',
                  title: t('columns.current'),
                  render: (n: number) => (n > 0 ? <Tag color="red">{n}</Tag> : <span>0</span>),
                },
                {
                  dataIndex: 'inFile',
                  title: t('columns.inFile'),
                  render: (n: number) => (n > 0 ? <Tag color="green">{n}</Tag> : <span>0</span>),
                },
              ]}
            />
            {warnings(preview.warnings)}
            <Popconfirm
              title={t('confirm.title')}
              description={t('confirm.body')}
              okText={t('run')}
              okButtonProps={{ danger: true }}
              onConfirm={restore}
            >
              <Button danger type="primary" loading={restoring}>
                {t('run')}
              </Button>
            </Popconfirm>
          </>
        )}

        {result && (
          <>
            <Alert
              type="success"
              showIcon
              message={t('done', { rows: result.restoredRows })}
              description={t('doneHint')}
            />
            {warnings(result.warnings)}
          </>
        )}
      </Space>
    </Card>
  );
}
