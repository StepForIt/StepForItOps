'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Tag, message } from 'antd';
import { Table } from '../../components/resizable-table';
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
        `${result.imported.length} sonde(s) importée(s)` +
          (result.skipped.length ? `, ${result.skipped.length} ignorée(s)` : ''),
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
      title="Importer les monitors Uptime Kuma existants"
      open={open}
      onCancel={onClose}
      onOk={doImport}
      okText={`Importer (${selected.length})`}
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={importing}
      width={900}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="push → monitor heartbeat ; http/keyword/ping → monitor actif (check assuré par Kuma)."
        description="Quand l'URL de la sonde pointe vers un webhook n8n connu, le monitor est rattaché automatiquement au workflow (colonne Workflow). Les monitors actifs importés sont désactivés localement pour ne pas doubler les checks de Kuma."
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
          { dataIndex: 'name', title: 'Nom' },
          {
            dataIndex: 'type',
            title: 'Type',
            width: 90,
            render: (t: string) => <Tag color={t === 'push' ? 'green' : undefined}>{t}</Tag>,
          },
          {
            dataIndex: 'active',
            title: 'Actif',
            width: 80,
            render: (a: boolean) => (a ? <Tag color="green">oui</Tag> : <Tag>non</Tag>),
          },
          {
            title: 'Workflow',
            width: 200,
            ellipsis: true,
            render: (_, probe) =>
              probe.matchedWorkflow ? <Tag color="geekblue">{probe.matchedWorkflow.name}</Tag> : '—',
          },
          {
            title: 'État',
            width: 140,
            render: (_, probe) =>
              probe.linkedMonitorId ? (
                <Tag color="blue">déjà rattachée</Tag>
              ) : probe.importable ? (
                <Tag color="gold">importable</Tag>
              ) : (
                <Tag>non importable</Tag>
              ),
          },
        ]}
      />
      {!loading && importableCount === 0 && probes.length > 0 && (
        <p style={{ marginTop: 12, color: '#888' }}>
          Aucune sonde importable : tout est déjà rattaché (ou de type groupe).
        </p>
      )}
    </Modal>
  );
}
