'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Tag, Tooltip, Typography, message } from 'antd';
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

const date = (value?: string) => (value ? new Date(value).toLocaleString('fr-FR') : '—');

/**
 * Le catalogue des types de nœuds (page Modules).
 *
 * Ce qu'il faut qu'on lise ici : d'où vient ce que la plateforme sait des nœuds,
 * et de quand ça date. Un catalogue périmé donne exactement les mêmes écrans
 * qu'un catalogue à jour — d'où la date de dernière synchro affichée en clair, et
 * l'échec montré tant qu'un succès ne l'a pas remplacé.
 */
export function NodeCatalogCard() {
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
      title="Catalogue des types de nœuds"
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load}>
            Rafraîchir
          </Button>
          <Tooltip title="Retélécharge le catalogue mutualisé si sa version amont a changé. Rien n'est téléchargé si elle n'a pas bougé.">
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
                      ? 'Catalogue déjà à jour — rien à télécharger.'
                      : `Catalogue mis à jour : ${result.added} ajoutés, ${result.updated} actualisés.`,
                )
              }
            >
              Mettre à jour
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {status?.nodeTypes === 0 && (
          <Alert type="warning" showIcon message="Catalogue vide" description="Lance « Mettre à jour »." />
        )}

        {status?.lastError && (
          <Alert
            type="error"
            showIcon
            message={`Dernière tentative en échec (${date(status.lastError.at)})`}
            description={status.lastError.message}
          />
        )}

        <Space size="large" wrap>
          <span>
            <Typography.Text strong>{status?.nodeTypes ?? '—'}</Typography.Text>{' '}
            <Typography.Text type="secondary">types de nœuds</Typography.Text>
          </span>
          <span>
            <Typography.Text type="secondary">source </Typography.Text>
            <Tag>{status?.source ?? '—'}</Tag>
          </span>
          <span>
            <Typography.Text type="secondary">dernière mise à jour </Typography.Text>
            <Typography.Text>{date(status?.lastSync?.at)}</Typography.Text>
          </span>
          {status?.lastSync?.n8nVersion && (
            <span>
              <Typography.Text type="secondary">décrit n8n </Typography.Text>
              <Tag color="blue">{status.lastSync.n8nVersion}</Tag>
            </span>
          )}
        </Space>

        <div>
          <Tooltip title="Avec un compte n8n (fiche de l'instance), l'instance prime sur le catalogue mutualisé.">
            <Typography.Text strong style={{ cursor: 'help' }}>
              Par instance
            </Typography.Text>
          </Tooltip>
          <Table
            size="small"
            style={{ marginTop: 8 }}
            rowKey="instanceId"
            pagination={false}
            dataSource={status?.instances ?? []}
            columns={[
              { title: 'Instance', dataIndex: 'name' },
              {
                title: 'Compte n8n',
                dataIndex: 'hasLogin',
                render: (hasLogin: boolean) =>
                  hasLogin ? 'enregistré' : <Typography.Text type="secondary">mutualisé</Typography.Text>,
              },
              {
                title: 'Types lus',
                dataIndex: 'nodeTypes',
                render: (count: number) => (count > 0 ? count : '—'),
              },
              {
                title: 'Dernière lecture',
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
                          `${result.imported} types lus sur ${row.name}.` +
                          (result.versionsError ? ` Schémas datés incomplets : ${result.versionsError}` : ''),
                      )
                    }
                  >
                    Lire les nœuds
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
