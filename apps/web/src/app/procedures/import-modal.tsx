'use client';

import React, { useEffect, useState } from 'react';
import { Alert, App, Modal, Radio, Space, Table, Tag, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import type { ImportConflict, ProcedureImportReport } from './procedure-transfer';

const OUTCOME_COLOR = { create: 'green', replace: 'orange', skip: undefined } as const;

/**
 * Import en deux temps : le fichier est relu par l'API en dry-run (ce qui sera
 * créé, remplacé, ignoré, et pourquoi on prévient), puis appliqué avec le MÊME
 * choix de conflit. Rien n'est écrit tant qu'on n'a pas vu le plan.
 */
export function ImportProceduresModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('misc.procedures.importModal');
  const { message } = App.useApp();
  const [bundle, setBundle] = useState<unknown>(null);
  const [onConflict, setOnConflict] = useState<ImportConflict>('skip');
  const [plan, setPlan] = useState<ProcedureImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) return;
    setBundle(null);
    setPlan(null);
    setError(null);
    setOnConflict('skip');
  }, [open]);

  // Le plan se relit à chaque choix de conflit : ce qui s'affiche est ce qui sera fait.
  useEffect(() => {
    if (!bundle) return;
    let alive = true;
    setError(null);
    apiPost<ProcedureImportReport>('/release-procedures/import', { bundle, onConflict, dryRun: true })
      .then((report) => alive && setPlan(report))
      .catch((e: Error) => {
        if (!alive) return;
        setPlan(null);
        setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [bundle, onConflict]);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setBundle(JSON.parse(String(reader.result)));
      } catch {
        setBundle(null);
        setPlan(null);
        setError(t('invalid'));
      }
    };
    reader.readAsText(file);
    return false;
  };

  const apply = async () => {
    setLoading(true);
    try {
      const report = await apiPost<ProcedureImportReport>('/release-procedures/import', {
        bundle,
        onConflict,
      });
      message.success(
        t('done', { created: report.created, replaced: report.replaced, skipped: report.skipped }),
      );
      onDone();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toWrite = plan ? plan.created + plan.replaced : 0;
  return (
    <Modal
      open={open}
      title={t('title')}
      okText={t('ok', { count: toWrite })}
      okButtonProps={{ disabled: !plan || toWrite === 0 }}
      confirmLoading={loading}
      onOk={apply}
      onCancel={onClose}
      width={720}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Upload.Dragger accept=".json,application/json" showUploadList={false} beforeUpload={onFile}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>{t('drop')}</p>
        </Upload.Dragger>
        {error && <Alert type="error" showIcon message={error} />}
        {plan && (
          <>
            <div>
              <Typography.Text type="secondary">{t('conflict')}</Typography.Text>
              <Radio.Group
                style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}
                value={onConflict}
                onChange={(event) => setOnConflict(event.target.value)}
              >
                <Radio value="skip">{t('skip')}</Radio>
                <Radio value="replace">{t('replace')}</Radio>
                <Radio value="duplicate">{t('duplicate')}</Radio>
              </Radio.Group>
            </div>
            <Table
              size="small"
              rowKey={(row) => `${row.name}:${row.importName}`}
              pagination={false}
              dataSource={plan.rows}
              columns={[
                {
                  key: 'name',
                  render: (_, row) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong>{row.name}</Typography.Text>
                      {row.importName !== row.name && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('as', { name: row.importName })}
                        </Typography.Text>
                      )}
                      {row.warnings.map((warning) => (
                        <Typography.Text key={warning} type="warning" style={{ fontSize: 12 }}>
                          {warning}
                        </Typography.Text>
                      ))}
                    </Space>
                  ),
                },
                { key: 'steps', dataIndex: 'steps', width: 60 },
                {
                  key: 'outcome',
                  width: 110,
                  render: (_, row) => (
                    <Tag color={OUTCOME_COLOR[row.outcome]}>{t(`outcome.${row.outcome}`)}</Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}
