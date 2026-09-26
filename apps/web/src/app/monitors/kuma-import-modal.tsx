'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Tag, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';

interface ImportableProbe {
  externalId: number;
  name: string;
  type: string;
  active: boolean;
  intervalSeconds?: number;
  pushUrl?: string;
  url?: string;
  linkedMonitorId: string | null;
  matchedWorkflow: { id: string; name: string } | null;
  importable: boolean;
}

interface KumaImportResult {
  imported: Array<{ externalId: number; name: string; monitorId: string; workflowName: string | null }>;
  skipped: Array<{ externalId: number; name: string; reason: string }>;
}

/** Import des monitors Uptime Kuma pré-existants (sondes push) en monitors locaux. */
export function KumaImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [probes, setProbes] = useState<ImportableProbe[]>([]);
  const t = useTranslations('health.monitors.import');
  const tc = useTranslations('common');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setLoading(true);
    apiGet<ImportableProbe[]>('/monitoring/kuma-probes')
      .then(setProbes)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  const doImport = async () => {
    setImporting(true);
    try {
      const result = await apiPost<KumaImportResult>('/monitoring/kuma-import', {
        externalIds: selected,
      });
      message.success(
        result.skipped.length
          ? t('importedWithSkipped', { count: result.imported.length, skipped: result.skipped.length })
          : t('imported', { count: result.imported.length }),
      );
      onImported();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const importableCount = probes.filter((p) => p.importable).length;

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      onOk={doImport}
      okText={t('ok', { count: selected.length })}
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={importing}
      width={900}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('info')}
        description={t('infoDetail')}
      />
      <Table<ImportableProbe>
        rowKey="externalId"
        dataSource={probes}
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ y: 360 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as number[]),
          getCheckboxProps: (probe) => ({ disabled: !probe.importable }),
        }}
        columns={[
          { dataIndex: 'name', title: tc('columns.name') },
          {
            dataIndex: 'type',
            title: tc('columns.type'),
            width: 90,
            render: (type: string) => <Tag color={type === 'push' ? 'green' : undefined}>{type}</Tag>,
          },
          {
            dataIndex: 'active',
            title: t('active'),
            width: 80,
            render: (a: boolean) => (a ? <Tag color="green">{t('yes')}</Tag> : <Tag>{t('no')}</Tag>),
          },
          {
            key: 'workflow',
            title: tc('columns.workflow'),
            width: 200,
            ellipsis: true,
            render: (_, probe) =>
              probe.matchedWorkflow ? <Tag color="blue">{probe.matchedWorkflow.name}</Tag> : '—',
          },
          {
            key: 'state',
            title: t('state'),
            width: 140,
            render: (_, probe) =>
              probe.linkedMonitorId ? (
                <Tag color="blue">{t('linked')}</Tag>
              ) : probe.importable ? (
                <Tag color="gold">{t('importable')}</Tag>
              ) : (
                <Tag>{t('notImportable')}</Tag>
              ),
          },
        ]}
      />
      {!loading && importableCount === 0 && probes.length > 0 && (
        <p style={{ marginTop: 12, color: '#888' }}>{t('noneImportable')}</p>
      )}
    </Modal>
  );
}
