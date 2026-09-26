'use client';

import React, { useEffect, useState } from 'react';
import { CreateButton, DeleteButton, EditButton, List, getDefaultSortOrder } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { useInvalidate, useSelect } from '@refinedev/core';
import { Alert, Button, Modal, Select, Space, Tag, Tooltip, message } from 'antd';
import { Table } from '../../components/resizable-table';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  FieldTimeOutlined,
  SettingOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { KumaSettingsModal } from './kuma-settings-modal';
import { ActionBar } from '../../components/action-bar';
import { KumaImportModal } from './kuma-import-modal';
import { KumaRedundancyModal } from './kuma-redundancy-modal';

interface Monitor {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  kumaPushUrl?: string;
  config?: { importedFromKuma?: boolean; instanceId?: string } | null;
  lastStatus?: string;
  lastCheckAt?: string;
  workflowId?: string | null;
  workflow?: { name: string; instanceId: string } | null;
}

interface ProvisionResult {
  created: Array<{ workflowName: string; pushUrl: string }>;
  skipped: string[];
  errorWatch?: { monitorId: string; pushUrl: string; created: boolean };
}

interface IntervalSyncResult {
  updated: Array<{ name: string; fromSeconds?: number; toSeconds: number }>;
  unchanged: number;
  skipped: Array<{ name: string; reason: string }>;
}

export default function MonitorsList() {
  const { scope, instanceName } = useInstanceScope();
  const t = useTranslations('health.monitors.list');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { tableProps, setFilters, sorters } = useTable<Monitor>({
    resource: 'monitors',
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
    // Scope connu dès le premier rendu (InstanceScopeGate) : premier chargement déjà filtré.
    filters: { initial: scope ? [{ field: 'instanceId', operator: 'eq', value: scope }] : [] },
  });
  const invalidate = useInvalidate();
  const [kumaConfigured, setKumaConfigured] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [redundancyOpen, setRedundancyOpen] = useState(false);
  const [instanceId, setInstanceId] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Scope global : filtre les monitors de l'instance (+ monitors globaux) et pré-remplit le provisioning
  useEffect(() => {
    setFilters([{ field: 'instanceId', operator: 'eq', value: scope ?? undefined }], 'merge');
    if (scope) setInstanceId(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const { options: instanceOptions } = useSelect({
    resource: 'instances',
    optionLabel: 'name',
    optionValue: 'id',
  });

  const refreshKumaStatus = () => {
    apiGet<{ configured: boolean }>('/monitoring/kuma-status')
      .then((s) => setKumaConfigured(s.configured))
      .catch(() => setKumaConfigured(false));
  };

  useEffect(refreshKumaStatus, []);

  const refresh = () => invalidate({ resource: 'monitors', invalidates: ['list'] });

  const provision = async (id: string) => {
    try {
      const monitor = await apiPost<Monitor>(`/monitors/${id}/provision`);
      message.success(t('probeCreated', { url: monitor.kumaPushUrl ?? '' }));
      refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const provisionInstance = async () => {
    if (!instanceId) return;
    setBusy(true);
    try {
      const result = await apiPost<ProvisionResult>(`/monitoring/provision-instance/${instanceId}`);
      Modal.success({
        title: t('provisioned', { created: result.created.length, skipped: result.skipped.length }),
        width: 640,
        content: (
          <>
            {result.errorWatch && (
              <p>{result.errorWatch.created ? t('errorWatchCreated') : t('errorWatchExisting')}</p>
            )}
            <ul>
              {result.created.map((c) => (
                <li key={c.workflowName}>
                  {t.rich('pasteSnippet', { name: c.workflowName, b: (chunks) => <b>{chunks}</b> })}
                </li>
              ))}
            </ul>
          </>
        ),
      });
      setBulkOpen(false);
      refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncIntervals = async () => {
    setBusy(true);
    try {
      const result = await apiPost<IntervalSyncResult>('/monitoring/kuma-sync-intervals');
      Modal.success({
        title: t('intervalsSynced', { updated: result.updated.length, unchanged: result.unchanged }),
        width: 640,
        content: (
          <>
            <p>{t('intervalsHint')}</p>
            <ul>
              {result.updated.map((u) => (
                <li key={u.name}>
                  {t.rich('intervalChange', {
                    name: u.name,
                    from: u.fromSeconds ?? '?',
                    to: u.toSeconds,
                    b: (chunks) => <b>{chunks}</b>,
                  })}
                </li>
              ))}
            </ul>
            {result.skipped.length > 0 && (
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.name} style={{ opacity: 0.65 }}>
                    {t('intervalSkipped', { name: s.name, reason: s.reason })}
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showSnippet = async (id: string) => {
    const snippet = await apiGet<object>(`/monitors/${id}/snippet`);
    Modal.info({
      title: t('snippetTitle'),
      width: 640,
      content: <pre style={{ maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(snippet, null, 2)}</pre>,
    });
  };

  const checkNow = async (id: string) => {
    try {
      const result = await apiPost<{ status: string }>(`/monitors/${id}/check`);
      message.success(t('checkResult', { status: result.status }));
      refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <List
      headerButtons={
        <ActionBar
          primary={<CreateButton />}
          actions={[
            {
              key: 'settings',
              label: t('actions.settings'),
              icon: <SettingOutlined />,
              onClick: () => setSettingsOpen(true),
            },
            {
              key: 'bulk',
              label: t('actions.bulk'),
              icon: <CloudUploadOutlined />,
              disabled: !kumaConfigured,
              onClick: () => setBulkOpen(true),
            },
            {
              key: 'import',
              label: t('actions.import'),
              icon: <CloudDownloadOutlined />,
              disabled: !kumaConfigured,
              onClick: () => setImportOpen(true),
            },
            {
              key: 'intervals',
              label: t('actions.intervals'),
              icon: <FieldTimeOutlined />,
              disabled: !kumaConfigured,
              loading: busy,
              onClick: () => void syncIntervals(),
            },
            {
              key: 'redundancy',
              label: t('actions.redundancy'),
              icon: <TagsOutlined />,
              disabled: !kumaConfigured,
              onClick: () => setRedundancyOpen(true),
            },
          ]}
        />
      }
    >
      {kumaConfigured === false && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('notConfigured')}
          description={t('notConfiguredHint')}
        />
      )}
      <Table {...tableProps} rowKey="id" mobileLayout={{ badges: ['lastStatus'] }}>
        <Table.Column
          dataIndex="name"
          title={tc('columns.name')}
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
        />
        {!scope && (
          <Table.Column<Monitor>
            title={tc('columns.instance')}
            render={(_, record) => {
              const monitorInstanceId = record.workflow?.instanceId ?? record.config?.instanceId;
              return monitorInstanceId ? (
                <Tag color="blue">{instanceName(monitorInstanceId)}</Tag>
              ) : (
                <Tag>{t('global')}</Tag>
              );
            }}
          />
        )}
        <Table.Column
          dataIndex="kind"
          title={tc('columns.type')}
          sorter
          defaultSortOrder={getDefaultSortOrder('kind', sorters)}
          render={(k: string) => <Tag>{k}</Tag>}
        />
        <Table.Column<Monitor>
          dataIndex="kumaPushUrl"
          title="Kuma"
          render={(url: string | undefined, record) =>
            url ? (
              <Tag color="green">{t('probeLinked')}</Tag>
            ) : record.config?.importedFromKuma ? (
              <Tag color="blue">{t('checkedByKuma')}</Tag>
            ) : (
              <Tag>—</Tag>
            )
          }
        />
        <Table.Column<Monitor>
          title={t('state')}
          render={(_, record) =>
            record.enabled ? (
              <Tag color="green">{t('enabled')}</Tag>
            ) : record.config?.importedFromKuma ? (
              <Tooltip title={t('managedByKumaTooltip')}>
                <Tag color="blue">{t('managedByKuma')}</Tag>
              </Tooltip>
            ) : (
              <Tag>{t('disabled')}</Tag>
            )
          }
        />
        <Table.Column
          dataIndex="lastStatus"
          title={t('lastStatus')}
          sorter
          defaultSortOrder={getDefaultSortOrder('lastStatus', sorters)}
          render={(s?: string) => (s ? <Tag color={s === 'up' ? 'green' : 'red'}>{s}</Tag> : <Tag>—</Tag>)}
        />
        <Table.Column
          dataIndex="lastCheckAt"
          title={t('lastCheck')}
          sorter
          defaultSortOrder={getDefaultSortOrder('lastCheckAt', sorters)}
          render={(d?: string) => (d ? new Date(d).toLocaleString(locale) : '—')}
        />
        <Table.Column<Monitor>
          title={tc('columns.actions')}
          className="row-actions"
          render={(_, record) => (
            <Space>
              {!record.kumaPushUrl && kumaConfigured && !record.config?.importedFromKuma && (
                <Button size="small" type="primary" onClick={() => provision(record.id)}>
                  {t('createProbe')}
                </Button>
              )}
              {record.kind === 'heartbeat' && (
                <Button size="small" onClick={() => showSnippet(record.id)}>
                  {t('snippet')}
                </Button>
              )}
              {(record.kind === 'active' || record.kind === 'error-watch') && (
                <Button size="small" onClick={() => checkNow(record.id)}>
                  {t('check')}
                </Button>
              )}
              <EditButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>

      <KumaSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={refreshKumaStatus}
      />

      <KumaImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />

      <KumaRedundancyModal open={redundancyOpen} onClose={() => setRedundancyOpen(false)} />

      <Modal
        title={t('bulkTitle')}
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={provisionInstance}
        okText={t('bulkOk')}
        confirmLoading={busy}
      >
        <p>{t.rich('bulkHint', { b: (chunks) => <b>{chunks}</b> })}</p>
        <Select
          placeholder={t('chooseInstance')}
          style={{ width: '100%' }}
          options={instanceOptions}
          value={instanceId}
          onChange={setInstanceId}
        />
      </Modal>
    </List>
  );
}
