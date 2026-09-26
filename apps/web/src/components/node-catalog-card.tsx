'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Tag, Tooltip, Typography, message } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { ResponsiveCard } from './mobile/responsive-card';
import { Table } from './resizable-table';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../lib/api';

interface CatalogStatus {
  nodeTypes: number;
  source: string;
  lastSync?: {
    at: string;
    revision?: string;
    n8nVersion?: string;
    added: number;
    updated: number;
    removed: number;
  };
  lastError?: { at: string; message: string };
  instances: Array<{
    instanceId: string;
    name: string;
    hasLogin: boolean;
    nodeTypes: number;
    lastSyncAt?: string;
  }>;
}

const formatDate = (locale: string, value?: string) => (value ? new Date(value).toLocaleString(locale) : '—');

/**
 * Le catalogue des types de nœuds (page Modules).
 *
 * Ce qu'il faut qu'on lise ici : d'où vient ce que la plateforme sait des nœuds,
 * et de quand ça date. Un catalogue périmé donne exactement les mêmes écrans
 * qu'un catalogue à jour — d'où la date de dernière synchro affichée en clair, et
 * l'échec montré tant qu'un succès ne l'a pas remplacé.
 */
export function NodeCatalogCard() {
  const t = useTranslations('settings.nodeCatalog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const date = (value?: string) => formatDate(locale, value);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<CatalogStatus>('/node-catalog/status')
      .then(setStatus)
      .catch((error) => message.error((error as Error).message));
  }, []);

  useEffect(load, [load]);

  const run = async <T,>(label: string, path: string, done: (result: T) => string) => {
    setBusy(label);
    try {
      message.success(done(await apiPost<T>(path, {})));
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ResponsiveCard
      size="small"
      title={t('title')}
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load}>
            {tc('refresh')}
          </Button>
          <Tooltip title={t('updateTooltip')}>
            <Button
              size="small"
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={busy === 'catalog'}
              onClick={() =>
                run<{ skipped: boolean; added: number; updated: number }>(
                  'catalog',
                  '/node-catalog/sync',
                  (result) =>
                    result.skipped
                      ? t('upToDate')
                      : t('updated', { added: result.added, updated: result.updated }),
                )
              }
            >
              {t('update')}
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {status?.nodeTypes === 0 && (
          <Alert type="warning" showIcon message={t('empty')} description={t('emptyHint')} />
        )}

        {status?.lastError && (
          <Alert
            type="error"
            showIcon
            message={t('lastError', { date: date(status.lastError.at) })}
            description={status.lastError.message}
          />
        )}

        <Space size="large" wrap>
          <span>
            <Typography.Text strong>{status?.nodeTypes ?? '—'}</Typography.Text>{' '}
            <Typography.Text type="secondary">{t('nodeTypes')}</Typography.Text>
          </span>
          <span>
            <Typography.Text type="secondary">{t('source')} </Typography.Text>
            <Tag>{status?.source ?? '—'}</Tag>
          </span>
          <span>
            <Typography.Text type="secondary">{t('lastUpdate')} </Typography.Text>
            <Typography.Text>{date(status?.lastSync?.at)}</Typography.Text>
          </span>
          {status?.lastSync?.n8nVersion && (
            <span>
              <Typography.Text type="secondary">{t('describes')} </Typography.Text>
              <Tag color="blue">{status.lastSync.n8nVersion}</Tag>
            </span>
          )}
        </Space>

        <div>
          <Tooltip title={t('perInstanceTooltip')}>
            <Typography.Text strong style={{ cursor: 'help' }}>
              {t('perInstance')}
            </Typography.Text>
          </Tooltip>
          <Table
            size="small"
            style={{ marginTop: 8 }}
            rowKey="instanceId"
            pagination={false}
            dataSource={status?.instances ?? []}
            columns={[
              { title: tc('columns.instance'), dataIndex: 'name' },
              {
                title: t('columns.account'),
                dataIndex: 'hasLogin',
                render: (hasLogin: boolean) =>
                  hasLogin ? (
                    t('accountStored')
                  ) : (
                    <Typography.Text type="secondary">{t('accountShared')}</Typography.Text>
                  ),
              },
              {
                title: t('columns.types'),
                dataIndex: 'nodeTypes',
                render: (count: number) => (count > 0 ? count : '—'),
              },
              {
                title: t('columns.lastRead'),
                dataIndex: 'lastSyncAt',
                render: (value?: string) => date(value),
              },
              {
                title: '',
                key: 'action',
                render: (_: unknown, row: CatalogStatus['instances'][number]) => (
                  <Button
                    size="small"
                    disabled={!row.hasLogin}
                    loading={busy === row.instanceId}
                    onClick={() =>
                      run<{ imported: number; versions: number; versionsError?: string }>(
                        row.instanceId,
                        `/node-catalog/sync/${row.instanceId}`,
                        (result) =>
                          result.versionsError
                            ? t('instanceReadPartial', {
                                count: result.imported,
                                name: row.name,
                                error: result.versionsError,
                              })
                            : t('instanceRead', { count: result.imported, name: row.name }),
                      )
                    }
                  >
                    {t('readNodes')}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Space>
    </ResponsiveCard>
  );
}
