'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Skeleton, Space, Tag, Typography } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { apiGet } from '../../lib/api';
import type { ExecutionErrorRow } from './types';

interface Props {
  /** Ligne cliquée dans le tableau (sert d'affichage immédiat pendant le chargement du détail). */
  row: ExecutionErrorRow | null;
  onClose: () => void;
}

/**
 * Détail d'une erreur. Le nœud fautif et le message sont récupérés depuis n8n
 * au premier affichage (`GET /execution-errors/:id`), puis servis du cache.
 */
export function ErrorDetailDrawer({ row, onClose }: Props) {
  const [detail, setDetail] = useState<ExecutionErrorRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDetail(row);
    setError(undefined);
    if (!row || row.detailState !== 'pending') return;
    setLoading(true);
    apiGet<ExecutionErrorRow>(`/execution-errors/${row.id}`)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [row]);

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      width={720}
      title={detail ? `Erreur — ${detail.workflowName}` : 'Erreur'}
      extra={
        detail?.n8nUrl && (
          <Button icon={<ExportOutlined />} href={detail.n8nUrl} target="_blank" rel="noreferrer noopener">
            Ouvrir dans n8n
          </Button>
        )
      }
    >
      {detail && (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Exécution">#{detail.executionId}</Descriptions.Item>
            <Descriptions.Item label="Démarrée">
              {new Date(detail.startedAt).toLocaleString('fr-FR')}
            </Descriptions.Item>
            <Descriptions.Item label="Durée">{duration(detail)}</Descriptions.Item>
            <Descriptions.Item label="Déclencheur">{detail.mode ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Nœud fautif">
              {detail.failedNode ? (
                <Space direction="vertical" size={2}>
                  <Tag color="red">{detail.failedNode}</Tag>
                  {detail.failedNodeType && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {detail.failedNodeType}
                    </Typography.Text>
                  )}
                </Space>
              ) : (
                '—'
              )}
            </Descriptions.Item>
          </Descriptions>

          {loading && <Skeleton active paragraph={{ rows: 3 }} />}

          {error && <Alert type="error" showIcon message="Détail non récupérable" description={error} />}

          {!loading && detail.detailState === 'unavailable' && (
            <Alert type="info" showIcon message="Exécution purgée par n8n." />
          )}

          {detail.message && (
            <>
              <Typography.Title level={5}>Message</Typography.Title>
              <Alert type="error" message={detail.message} style={{ marginBottom: 16 }} />
            </>
          )}

          {detail.stack && (
            <>
              <Typography.Title level={5}>Stack</Typography.Title>
              <pre
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  background: '#fafafa',
                  padding: 12,
                  fontSize: 12,
                }}
              >
                {detail.stack}
              </pre>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

function duration(row: ExecutionErrorRow): string {
  if (!row.stoppedAt) return '—';
  const ms = new Date(row.stoppedAt).getTime() - new Date(row.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
