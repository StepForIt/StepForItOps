'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, List, Modal, Space, Tag, Tooltip, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost, apiPut } from '../../lib/api';

/** Credential NocoDB vu dans les workflows, avec le host déjà renseigné. */
interface NocoDbEndpoint {
  credentialType: string;
  credentialId: string;
  credentialName?: string;
  projectIds: string[];
  nodeCount: number;
  host?: string;
  hostCandidates: HostHint[];
}

/** Instance devinée depuis un appel HTTP d'un workflow, avec sa preuve. */
interface HostHint {
  host: string;
  matchedId: string;
  sourceUrl: string;
  workflowName?: string;
  nodeName?: string;
}

interface RefreshResult {
  resolved: number;
  missingHost: Array<{ credentialId: string; credentialName?: string }>;
  failed: Array<{ credentialId: string; projectId?: string; reason: string }>;
}

interface Props {
  open: boolean;
  instanceId: string;
  onClose: () => void;
  /** Appelé après une découverte réussie : la liste des tables est à recharger. */
  onResolved: () => void;
}

/**
 * Retrouve les vrais noms des tables NocoDB. Seule l'URL de l'API se saisit ici (le credential
 * n8n qui la porte n'est pas lisible) ; le token, lui, ne quitte jamais n8n.
 */
export function NocoDbNamesModal({ open, instanceId, onClose, onResolved }: Props) {
  const t = useTranslations('inventory.resources.nocodb');
  const [endpoints, setEndpoints] = useState<NocoDbEndpoint[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);

  const load = useCallback(() => {
    apiGet<NocoDbEndpoint[]>(`/resource-discovery/nocodb/endpoints?instanceId=${instanceId}`)
      .then((rows) => {
        setEndpoints(rows);
        setDrafts(Object.fromEntries(rows.map((row) => [row.credentialId, row.host ?? ''])));
      })
      .catch((error: Error) => message.error(error.message));
  }, [instanceId]);

  useEffect(() => {
    if (open) {
      setResult(null);
      load();
    }
  }, [open, load]);

  const saveHost = async (credentialId: string): Promise<void> => {
    const host = drafts[credentialId]?.trim();
    if (!host) return;
    setBusy(true);
    try {
      await apiPut('/resource-discovery/nocodb/endpoints', { credentialId, host });
      load();
      message.success(t('saved'));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await apiPost<RefreshResult>('/resource-discovery/nocodb/refresh-labels', {
        instanceId,
      });
      setResult(outcome);
      if (outcome.resolved > 0) onResolved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = endpoints.some((endpoint) => endpoint.host);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('title')}
      width={720}
      footer={[
        <Button key="close" onClick={onClose}>
          {t('close')}
        </Button>,
        <Button key="run" type="primary" loading={busy} disabled={!ready} onClick={refresh}>
          {t('run')}
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary">{t('intro')}</Typography.Paragraph>

      {endpoints.length === 0 ? (
        <Alert type="info" showIcon message={t('noNodes')} />
      ) : (
        <List
          dataSource={endpoints}
          rowKey={(endpoint) => endpoint.credentialId}
          renderItem={(endpoint) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space size={4} wrap>
                    <span>{endpoint.credentialName ?? endpoint.credentialId}</span>
                    {!endpoint.host && <Tag color="orange">{t('missingHost')}</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Typography.Text type="secondary">
                      {t('counts', { nodes: endpoint.nodeCount, bases: endpoint.projectIds.length })}
                    </Typography.Text>
                    <Space.Compact style={{ width: '100%', maxWidth: 460 }}>
                      <Input
                        placeholder={t('hostPlaceholder')}
                        value={drafts[endpoint.credentialId] ?? ''}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [endpoint.credentialId]: event.target.value,
                          }))
                        }
                        onPressEnter={() => saveHost(endpoint.credentialId)}
                      />
                      <Button onClick={() => saveHost(endpoint.credentialId)} loading={busy}>
                        {t('save')}
                      </Button>
                    </Space.Compact>
                    {!endpoint.host && endpoint.hostCandidates.length > 0 && (
                      <Space size={4} wrap>
                        <Typography.Text type="secondary">{t('seenIn')}</Typography.Text>
                        {endpoint.hostCandidates.map((hint) => (
                          <Tooltip
                            key={hint.host}
                            title={t('hint', {
                              workflow: hint.workflowName ?? t('aWorkflow'),
                              node: hint.nodeName ?? t('aNode'),
                              url: hint.sourceUrl,
                            })}
                          >
                            <Tag
                              color="blue"
                              style={{ cursor: 'pointer' }}
                              onClick={() =>
                                setDrafts((current) => ({
                                  ...current,
                                  [endpoint.credentialId]: hint.host,
                                }))
                              }
                            >
                              {hint.host}
                            </Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}

      {result && (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
          {result.resolved > 0 && (
            <Typography.Text type="secondary">{t('resolved', { count: result.resolved })}</Typography.Text>
          )}
          {result.missingHost.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('ignored')}
              description={result.missingHost
                .map((entry) => entry.credentialName ?? entry.credentialId)
                .join(', ')}
            />
          )}
          {result.failed.map((failure, index) => (
            <Alert
              key={`${failure.credentialId}:${failure.projectId ?? ''}:${index}`}
              type="error"
              showIcon
              message={
                failure.projectId ? t('failedOnBase', { base: failure.projectId }) : t('failedListing')
              }
              description={failure.reason}
            />
          ))}
        </Space>
      )}
    </Modal>
  );
}
