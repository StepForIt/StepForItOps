'use client';

import React from 'react';
import { Alert, Button, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';

type CleanupStatus = 'duplicate' | 'pending' | 'unknown';

interface CleanupEntry {
  path: string;
  status: CleanupStatus;
  externalId: string | null;
  workflowName: string | null;
  expectedPath: string | null;
  reason: string;
}

interface CleanupReport {
  targetId: string;
  targetName: string;
  kind: string;
  total: number;
  ok: number;
  entries: CleanupEntry[];
  deleted?: string[];
}

interface Target {
  id: string;
  name: string;
  kind: string;
}

const STATUS_COLOR: Record<CleanupStatus, string> = {
  duplicate: 'red',
  pending: 'orange',
  unknown: 'default',
};

/** Repère les fichiers laissés par les renommages dans une cible, puis les supprime. */
export function CleanupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('inventory.versions.cleanup');
  const [targets, setTargets] = React.useState<Target[]>([]);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<CleanupReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setReport(null);
    setError(null);
    apiGet<Target[]>('/export-targets')
      .then((list) => {
        setTargets(list);
        if (list.length === 1) setTargetId(list[0].id);
      })
      .catch((e) => setError((e as Error).message));
  }, [open]);

  const analyse = async (id: string) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      setReport(await apiGet<CleanupReport>(`/export-targets/${id}/cleanup`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const duplicates = report?.entries.filter((entry) => entry.status === 'duplicate') ?? [];

  const remove = async () => {
    if (!targetId) return;
    setDeleting(true);
    try {
      const result = await apiPost<CleanupReport>(`/export-targets/${targetId}/cleanup`);
      message.success(t('deleted', { count: result.deleted?.length ?? 0 }));
      setReport(result);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      width={860}
      footer={[
        <Button key="close" onClick={onClose}>
          {t('close')}
        </Button>,
        <Button
          key="delete"
          danger
          type="primary"
          loading={deleting}
          disabled={duplicates.length === 0}
          onClick={remove}
        >
          {t('delete', { count: duplicates.length })}
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space>
          <Select
            style={{ width: 360 }}
            placeholder={t('selectTarget')}
            value={targetId}
            onChange={(value: string) => {
              setTargetId(value);
              setReport(null);
            }}
            options={targets.map((target) => ({
              value: target.id,
              label: `${target.name} (${target.kind})`,
            }))}
          />
          <Button type="primary" disabled={!targetId} loading={loading} onClick={() => analyse(targetId!)}>
            {t('analyse')}
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message={t('analyseFailed')} description={error} />}

        {report && (
          <>
            <Typography.Text>
              {t.rich('deletable', { count: duplicates.length, b: (chunks) => <strong>{chunks}</strong> })}
            </Typography.Text>
            {report.entries.some((entry) => entry.status === 'pending') && (
              <Alert
                type="warning"
                showIcon
                message={t('pendingTitle')}
                description={t('pendingDescription')}
              />
            )}
            <Table
              size="small"
              rowKey="path"
              dataSource={report.entries}
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: t('columns.state'),
                  dataIndex: 'status',
                  width: 130,
                  render: (status: CleanupStatus) => (
                    <Tag color={STATUS_COLOR[status]}>{t(`status.${status}`)}</Tag>
                  ),
                },
                {
                  title: t('columns.file'),
                  dataIndex: 'path',
                  render: (path: string) => <code style={{ fontSize: 12 }}>{path}</code>,
                },
                {
                  title: t('columns.workflow'),
                  dataIndex: 'workflowName',
                  render: (name: string | null, entry: CleanupEntry) =>
                    name ?? <Typography.Text type="secondary">{entry.externalId ?? '—'}</Typography.Text>,
                },
                { title: t('columns.why'), dataIndex: 'reason' },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}
