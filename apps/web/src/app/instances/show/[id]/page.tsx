'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useOne, useList } from '@refinedev/core';
import { Show, EditButton } from '@refinedev/antd';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ApiOutlined, CloudSyncOutlined, MonitorOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('settings.instanceShow');
  const tc = useTranslations('common');
  const locale = useLocale();
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
      title={instance?.name ?? tc('columns.instance')}
      headerButtons={<EditButton recordItemId={instanceId} />}
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label={tc('columns.name')}>{instance?.name}</Descriptions.Item>
        <Descriptions.Item label={t('platform')}>
          <Tag color={instance?.platform === 'make' ? 'purple' : 'blue'}>
            {instance?.platform === 'make' ? 'Make.com' : 'n8n'}
          </Tag>
        </Descriptions.Item>
        {instance?.platform === 'make' ? (
          <Descriptions.Item label={t('makeAccount')}>
            {instance.zone ?? '—'}
            {instance.externalTeamId ? t('team', { id: instance.externalTeamId }) : ''}
            {instance.externalOrgId ? t('org', { id: instance.externalOrgId }) : ''}
          </Descriptions.Item>
        ) : (
          <Descriptions.Item label={t('baseUrl')}>
            {instance?.baseUrl && (
              <a href={instance.baseUrl} target="_blank" rel="noreferrer">
                {instance.baseUrl}
              </a>
            )}
          </Descriptions.Item>
        )}
        <Descriptions.Item label={t('apiKey')}>
          <Tag>{t('stored')}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('storedHint')}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('synced')}>
          {workflows?.total ?? 0}
          {workflows?.total ? (
            <>
              {' — '}
              <Link href="/workflows">{t('seeList')}</Link>
            </>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label={t('lastSync')}>
          {lastSync ? (
            new Date(lastSync).toLocaleString(locale)
          ) : (
            <Typography.Text type="secondary">{t('neverSynced')}</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Card size="small" title={tc('columns.actions')} style={{ marginTop: 16 }}>
        <Space wrap>
          <Button icon={<ApiOutlined />} loading={testing} onClick={testConnection}>
            {t('testConnection')}
          </Button>
          <Button type="primary" icon={<CloudSyncOutlined />} onClick={() => setSyncOpen(true)}>
            {t('sync')}
          </Button>
          <Button icon={<MonitorOutlined />} onClick={() => setMonitoringOpen(true)}>
            {t('monitoring')}
          </Button>
        </Space>

        {test && (
          <Alert
            style={{ marginTop: 12 }}
            type={test.ok ? 'success' : 'error'}
            showIcon
            message={test.ok ? t('connectionOk') : t('connectionKo')}
            description={test.ok ? t('visible', { count: test.workflowCount ?? 0 }) : test.error}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('testHint')}
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
