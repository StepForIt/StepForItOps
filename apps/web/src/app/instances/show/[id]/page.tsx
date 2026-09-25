'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useOne, useList } from '@refinedev/core';
import { Show, EditButton } from '@refinedev/antd';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ApiOutlined, CloudSyncOutlined, MonitorOutlined } from '@ant-design/icons';
import { apiPost } from '../../../../lib/api';
import { MonitoringChecklistModal } from '../../monitoring-checklist-modal';
import { SyncModal } from '../../sync-modal';

interface Instance {
  id: string;
  name: string;
  baseUrl: string;
  platform: 'n8n' | 'make';
  zone: string | null;
  externalOrgId: string | null;
  externalTeamId: string | null;
}

interface TestResult {
  ok: boolean;
  workflowCount?: number;
  error?: string;
}

/** Détail d'une instance : identité, état de la connexion, workflows synchronisés, actions. */
export default function InstanceShow() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;
  const { data, isLoading } = useOne<Instance>({ resource: 'instances', id: instanceId });
  const instance = data?.data;

  // Dernier workflow synchronisé : donne le total (x-total-count) et la date de dernière synchro.
  const { data: workflows } = useList<{ id: string; name: string; updatedAt: string }>({
    resource: 'workflows',
    filters: [
      { field: 'instanceId', operator: 'eq', value: instanceId },
      { field: 'archived', operator: 'eq', value: 'all' },
    ],
    sorters: [{ field: 'updatedAt', order: 'desc' }],
    pagination: { current: 1, pageSize: 1 },
  });
  const lastSync = workflows?.data?.[0]?.updatedAt;

  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [monitoringOpen, setMonitoringOpen] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      setTest(await apiPost<TestResult>(`/instances/${instanceId}/test`));
    } catch (error) {
      setTest({ ok: false, error: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Show
      isLoading={isLoading}
      title={instance?.name ?? 'Instance'}
      headerButtons={<EditButton recordItemId={instanceId} />}
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="Nom">{instance?.name}</Descriptions.Item>
        <Descriptions.Item label="Plateforme">
          <Tag color={instance?.platform === 'make' ? 'purple' : 'blue'}>
            {instance?.platform === 'make' ? 'Make.com' : 'n8n'}
          </Tag>
        </Descriptions.Item>
        {instance?.platform === 'make' ? (
          <Descriptions.Item label="Compte Make">
            {instance.zone ?? '—'}
            {instance.externalTeamId ? ` · team ${instance.externalTeamId}` : ''}
            {instance.externalOrgId ? ` · organisation ${instance.externalOrgId}` : ''}
          </Descriptions.Item>
        ) : (
          <Descriptions.Item label="URL de base">
            {instance?.baseUrl && (
              <a href={instance.baseUrl} target="_blank" rel="noreferrer">
                {instance.baseUrl}
              </a>
            )}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Clé API">
          <Tag>enregistrée</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            modifiable depuis « Éditer »
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Workflows synchronisés">
          {workflows?.total ?? 0}
          {workflows?.total ? (
            <>
              {' — '}
              <Link href="/workflows">voir la liste</Link>
            </>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label="Dernière synchronisation">
          {lastSync ? (
            new Date(lastSync).toLocaleString('fr-FR')
          ) : (
            <Typography.Text type="secondary">jamais synchronisée</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Card size="small" title="Actions" style={{ marginTop: 16 }}>
        <Space wrap>
          <Button icon={<ApiOutlined />} loading={testing} onClick={testConnection}>
            Tester la connexion
          </Button>
          <Button type="primary" icon={<CloudSyncOutlined />} onClick={() => setSyncOpen(true)}>
            Synchroniser
          </Button>
          <Button icon={<MonitorOutlined />} onClick={() => setMonitoringOpen(true)}>
            Monitoring
          </Button>
        </Space>

        {test && (
          <Alert
            style={{ marginTop: 12 }}
            type={test.ok ? 'success' : 'error'}
            showIcon
            message={test.ok ? 'Connexion OK' : 'Connexion KO'}
            description={test.ok ? `${test.workflowCount} workflows visibles depuis l'API n8n.` : test.error}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Le test appelle l&apos;API n8n en lecture seule avec la clé enregistrée. Pour tester des
          identifiants avant de les enregistrer, utilise le bouton du formulaire d&apos;édition.
        </Typography.Paragraph>
      </Card>

      <SyncModal
        instanceId={syncOpen ? instanceId : null}
        instanceName={instance?.name}
        onClose={() => setSyncOpen(false)}
      />
      <MonitoringChecklistModal
        instanceId={monitoringOpen ? instanceId : null}
        instanceName={instance?.name}
        onClose={() => setMonitoringOpen(false)}
      />
    </Show>
  );
}
