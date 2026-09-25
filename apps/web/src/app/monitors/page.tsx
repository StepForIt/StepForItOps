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
      message.success(`Sonde Kuma créée : ${monitor.kumaPushUrl}`);
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
        title: `${result.created.length} sondes créées, ${result.skipped.length} déjà couvertes`,
        width: 640,
        content: (
          <>
            {result.errorWatch && (
              <p>
                Monitor « erreurs d&apos;exécution » de l&apos;instance :{' '}
                {result.errorWatch.created ? 'créé (poll API, sans exécution n8n)' : 'déjà en place'}.
              </p>
            )}
            <ul>
              {result.created.map((c) => (
                <li key={c.workflowName}>
                  <b>{c.workflowName}</b> → colle le snippet heartbeat dans ce workflow (bouton « Snippet »)
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
        title: `${result.updated.length} sonde(s) réalignée(s), ${result.unchanged} déjà correcte(s)`,
        width: 640,
        content: (
          <>
            <p>
              L&apos;intervalle d&apos;une sonde push doit être plus large que la cadence réelle de push,
              sinon Kuma la déclare DOWN alors que le beat n&apos;est pas encore dû.
            </p>
            <ul>
              {result.updated.map((u) => (
                <li key={u.name}>
                  <b>{u.name}</b> : {u.fromSeconds ?? '?'} s → {u.toSeconds} s
                </li>
              ))}
            </ul>
            {result.skipped.length > 0 && (
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.name} style={{ opacity: 0.65 }}>
                    {s.name} — ignoré ({s.reason})
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
      title: 'Nœud HTTP Request à coller dans le workflow',
      width: 640,
      content: <pre style={{ maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(snippet, null, 2)}</pre>,
    });
  };

  const checkNow = async (id: string) => {
    try {
      const result = await apiPost<{ status: string }>(`/monitors/${id}/check`);
      message.success(`Check : ${result.status}`);
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
              label: 'Réglages Kuma',
              icon: <SettingOutlined />,
              onClick: () => setSettingsOpen(true),
            },
            {
              key: 'bulk',
              label: 'Sondes Kuma pour une instance',
              icon: <CloudUploadOutlined />,
              disabled: !kumaConfigured,
              onClick: () => setBulkOpen(true),
            },
            {
              key: 'import',
              label: 'Importer depuis Kuma',
              icon: <CloudDownloadOutlined />,
              disabled: !kumaConfigured,
              onClick: () => setImportOpen(true),
            },
            {
              key: 'intervals',
              label: 'Réaligner les intervalles',
              icon: <FieldTimeOutlined />,
              disabled: !kumaConfigured,
              loading: busy,
              onClick: () => void syncIntervals(),
            },
            {
              key: 'redundancy',
              label: 'Sondes redondantes',
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
          message="Connecteur Uptime Kuma non configuré"
          description={
            <>
              Renseigne l&apos;URL et les identifiants Kuma via le bouton « Réglages Kuma » (stockés en base),
              ou via KUMA_URL, KUMA_USERNAME et KUMA_PASSWORD dans le .env de l&apos;API. Sans ça, tu peux
              toujours coller manuellement une URL push dans chaque monitor.
            </>
          }
        />
      )}
      <Table {...tableProps} rowKey="id" mobileLayout={{ badges: ['lastStatus'] }}>
        <Table.Column
          dataIndex="name"
          title="Nom"
          sorter
          defaultSortOrder={getDefaultSortOrder('name', sorters)}
        />
        {!scope && (
          <Table.Column<Monitor>
            title="Instance"
            render={(_, record) => {
              const monitorInstanceId = record.workflow?.instanceId ?? record.config?.instanceId;
              return monitorInstanceId ? (
                <Tag color="geekblue">{instanceName(monitorInstanceId)}</Tag>
              ) : (
                <Tag>global</Tag>
              );
            }}
          />
        )}
        <Table.Column
          dataIndex="kind"
          title="Type"
          sorter
          defaultSortOrder={getDefaultSortOrder('kind', sorters)}
          render={(k: string) => <Tag>{k}</Tag>}
        />
        <Table.Column<Monitor>
          dataIndex="kumaPushUrl"
          title="Kuma"
          render={(url: string | undefined, record) =>
            url ? (
              <Tag color="green">sonde liée</Tag>
            ) : record.config?.importedFromKuma ? (
              <Tag color="blue">check par Kuma</Tag>
            ) : (
              <Tag>—</Tag>
            )
          }
        />
        <Table.Column<Monitor>
          title="État"
          render={(_, record) =>
            record.enabled ? (
              <Tag color="green">actif</Tag>
            ) : record.config?.importedFromKuma ? (
              <Tooltip title="Volontairement inactif ici : c'est Uptime Kuma qui exécute ce check. L'activer doublerait les appels — et un check sur un webhook déclenche une exécution n8n.">
                <Tag color="blue">géré par Kuma</Tag>
              </Tooltip>
            ) : (
              <Tag>désactivé</Tag>
            )
          }
        />
        <Table.Column
          dataIndex="lastStatus"
          title="Dernier statut"
          sorter
          defaultSortOrder={getDefaultSortOrder('lastStatus', sorters)}
          render={(s?: string) => (s ? <Tag color={s === 'up' ? 'green' : 'red'}>{s}</Tag> : <Tag>—</Tag>)}
        />
        <Table.Column
          dataIndex="lastCheckAt"
          title="Dernier check"
          sorter
          defaultSortOrder={getDefaultSortOrder('lastCheckAt', sorters)}
          render={(d?: string) => (d ? new Date(d).toLocaleString('fr-FR') : '—')}
        />
        <Table.Column<Monitor>
          title="Actions"
          className="row-actions"
          render={(_, record) => (
            <Space>
              {!record.kumaPushUrl && kumaConfigured && !record.config?.importedFromKuma && (
                <Button size="small" type="primary" onClick={() => provision(record.id)}>
                  Créer sonde Kuma
                </Button>
              )}
              {record.kind === 'heartbeat' && (
                <Button size="small" onClick={() => showSnippet(record.id)}>
                  Snippet
                </Button>
              )}
              {(record.kind === 'active' || record.kind === 'error-watch') && (
                <Button size="small" onClick={() => checkNow(record.id)}>
                  Check
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
        title="Créer les sondes Kuma d'une instance"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={provisionInstance}
        okText="Créer les sondes"
        confirmLoading={busy}
      >
        <p>
          Pour chaque workflow <b>actif</b> sans monitor heartbeat : crée le monitor local + la sonde push
          dans Uptime Kuma. Il restera à coller le snippet heartbeat dans chaque workflow.
        </p>
        <Select
          placeholder="Choisir l'instance n8n"
          style={{ width: '100%' }}
          options={instanceOptions}
          value={instanceId}
          onChange={setInstanceId}
        />
      </Modal>
    </List>
  );
}
