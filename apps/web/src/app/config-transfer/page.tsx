'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { DownloadOutlined, ImportOutlined, InboxOutlined } from '@ant-design/icons';
import { API_URL, apiGet, apiPost } from '../../lib/api';
import { FieldLabel } from '../../components/field-label';

type ImportStrategy = 'merge' | 'skip-existing';

interface SectionReport {
  created: number;
  updated: number;
  skipped: number;
}

interface ImportReport {
  dryRun: boolean;
  strategy: ImportStrategy;
  sections: Record<string, SectionReport>;
  warnings: string[];
}

interface ConfigBundle {
  kind: string;
  version: number;
  exportedAt: string;
  includesSecrets: boolean;
  [key: string]: unknown;
}

// Libellé : `misc.configTransfer.sections.<clé>` ; une section inconnue s'affiche sous sa clé.
const SECTION_KEYS = [
  'instances',
  'exportTargets',
  'resourceMappings',
  'monitors',
  'monitoringSettings',
  'aiSettings',
  'moduleStates',
  'platformSettings',
  'findingIgnores',
  'workflowGroups',
  'workflowLinks',
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const isSectionKey = (key: string): key is SectionKey => (SECTION_KEYS as readonly string[]).includes(key);

export default function ConfigTransferPage() {
  const t = useTranslations('misc.configTransfer');
  const locale = useLocale();
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [exporting, setExporting] = useState(false);
  // null tant que l'API n'a pas répondu : on n'affiche ni le bouton ni le refus
  // avant de savoir, pour ne pas faire clignoter l'un puis l'autre.
  const [exportEnabled, setExportEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<{ exportEnabled: boolean }>('/config-transfer/capabilities')
      .then((c) => setExportEnabled(c.exportEnabled))
      .catch(() => setExportEnabled(false));
  }, []);

  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [fileName, setFileName] = useState('');
  const [strategy, setStrategy] = useState<ImportStrategy>('merge');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);

  const download = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${API_URL}/config-transfer/export?includeSecrets=${includeSecrets}`);
      if (!response.ok) throw new Error(`Export → ${response.status}`);
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nwm-config-${new Date().toISOString().slice(0, 10)}${includeSecrets ? '' : '-sans-secrets'}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(t('toast.exported'));
    } catch (error) {
      message.error(t('toast.exportFailed', { error: (error as Error).message }));
    } finally {
      setExporting(false);
    }
  };

  const runPreview = async (nextBundle: ConfigBundle, nextStrategy: ImportStrategy) => {
    try {
      const report = await apiPost<ImportReport>('/config-transfer/import', {
        bundle: nextBundle,
        strategy: nextStrategy,
        dryRun: true,
      });
      setPreview(report);
    } catch (error) {
      setBundle(null);
      setPreview(null);
      message.error(t('toast.fileRefused', { error: (error as Error).message }));
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ConfigBundle;
        setResult(null);
        setBundle(parsed);
        setFileName(file.name);
        void runPreview(parsed, strategy);
      } catch {
        message.error(t('toast.invalidJson'));
      }
    };
    reader.readAsText(file);
    return false; // pas d'upload auto : tout passe par l'endpoint d'import
  };

  const changeStrategy = (next: ImportStrategy) => {
    setStrategy(next);
    if (bundle) void runPreview(bundle, next);
  };

  const doImport = async () => {
    if (!bundle) return;
    setImporting(true);
    try {
      const report = await apiPost<ImportReport>('/config-transfer/import', {
        bundle,
        strategy,
        dryRun: false,
      });
      setResult(report);
      setPreview(null);
      setBundle(null);
      message.success(t('toast.imported'));
    } catch (error) {
      message.error(t('toast.importFailed', { error: (error as Error).message }));
    } finally {
      setImporting(false);
    }
  };

  const reportRows = (report: ImportReport) =>
    Object.entries(report.sections).map(([key, counts]) => ({
      key,
      section: isSectionKey(key) ? t(`sections.${key}`) : key,
      ...counts,
    }));

  const reportTable = (report: ImportReport) => (
    <Table
      dataSource={reportRows(report)}
      pagination={false}
      size="small"
      columns={[
        { dataIndex: 'section', title: t('report.section') },
        {
          dataIndex: 'created',
          title: report.dryRun ? t('report.toCreate') : t('report.created'),
          render: (n: number) => (n > 0 ? <Tag color="green">{n}</Tag> : <span>0</span>),
        },
        {
          dataIndex: 'updated',
          title: report.dryRun ? t('report.toUpdate') : t('report.updated'),
          render: (n: number) => (n > 0 ? <Tag color="blue">{n}</Tag> : <span>0</span>),
        },
        {
          dataIndex: 'skipped',
          title: report.dryRun ? t('report.toSkip') : t('report.skipped'),
          render: (n: number) => (n > 0 ? <Tag>{n}</Tag> : <span>0</span>),
        },
      ]}
    />
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title={t('export.title')}>
        <Space direction="vertical">
          <Typography.Text type="secondary">{t('export.intro')}</Typography.Text>
          {exportEnabled === false && (
            <Alert
              type="warning"
              showIcon
              message={t('export.disabled.title')}
              description={t('export.disabled.body')}
            />
          )}
          {exportEnabled === true && (
            <>
              <Checkbox checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)}>
                {t('export.includeSecrets')}
              </Checkbox>
              {includeSecrets && <Alert type="warning" showIcon message={t('export.secretsWarning')} />}
              <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={download}>
                {t('export.download')}
              </Button>
            </>
          )}
        </Space>
      </Card>

      <Card title={t('import.title')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <FieldLabel htmlFor="config-import-file" required>
            {t('import.file')}
          </FieldLabel>
          <Upload.Dragger
            id="config-import-file"
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={onFile}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{t('import.drop')}</p>
            <p className="ant-upload-hint">{t('import.dropHint')}</p>
          </Upload.Dragger>

          <Alert
            type="info"
            showIcon
            message={t('import.twoPasses.title')}
            description={t('import.twoPasses.body')}
          />

          <Radio.Group value={strategy} onChange={(e) => changeStrategy(e.target.value as ImportStrategy)}>
            <Radio.Button value="merge">{t('import.merge')}</Radio.Button>
            <Radio.Button value="skip-existing">{t('import.skipExisting')}</Radio.Button>
          </Radio.Group>

          {bundle && preview && (
            <>
              <Alert
                type="info"
                showIcon
                message={t('import.preview', {
                  file: fileName,
                  date: new Date(bundle.exportedAt).toLocaleString(locale),
                  secrets: bundle.includesSecrets ? 'with' : 'without',
                })}
                description={t('import.previewHint')}
              />
              {reportTable(preview)}
              {preview.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('warnings')}
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  }
                />
              )}
              <Popconfirm title={t('import.confirm')} okText={t('import.run')} onConfirm={doImport}>
                <Button type="primary" icon={<ImportOutlined />} loading={importing}>
                  {t('import.run')}
                </Button>
              </Popconfirm>
            </>
          )}

          {result && (
            <>
              <Alert type="success" showIcon message={t('import.done')} />
              {reportTable(result)}
              {result.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('warnings')}
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </>
          )}
        </Space>
      </Card>
    </Space>
  );
}
