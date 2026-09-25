'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, TableOutlined } from '@ant-design/icons';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { useInstanceScope } from '../lib/instance-scope';
import { useEnvs } from '../lib/envs';

interface ProviderCatalogEntry {
  provider: string;
  credentialTypes: string[];
  steps: Array<{ id: string; label: string; parentStepId?: string }>;
}

interface HarvestedCredential {
  type: string;
  id: string;
  name?: string;
  usedBy: number;
}

interface DiscoveryLeftover {
  externalId: string;
  name: string;
  active: boolean;
  url: string;
  lastExecution?: {
    id: string;
    status: string;
    startedAt?: string;
    failedNode?: string;
    message?: string;
    url: string;
  };
}

export interface DiscoveredItem {
  id: string;
  name: string;
  suggestedKey: string;
}

interface InstanceRow {
  id: string;
  name: string;
}

/**
 * Le provider `credential` ne se découvre pas comme une base : l'API n8n ne liste
 * pas les credentials, mais la plateforme les a déjà relevées dans les workflows
 * snapshotés — c'est la même récolte, sans workflow temporaire ni appel au tiers.
 */
const CREDENTIAL_PROVIDER = 'credential';

/** `airtableTokenApi` → `airtable_token_api` : la même clé des deux côtés du mapping. */
function credentialKeyOf(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Drawer « Parcourir depuis n8n » : liste les bases/tables réelles d'un provider
 * via le module resource-discovery, et injecte les ids choisis dans le mapping.
 */
export function ResourceDiscoveryBrowser({
  open,
  provider,
  onClose,
  onPick,
}: {
  open: boolean;
  provider?: string;
  onClose: () => void;
  onPick: (item: DiscoveredItem, env: string) => void;
}) {
  const { scope } = useInstanceScope();
  const { envs } = useEnvs();
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [instanceId, setInstanceId] = useState<string>();
  const [credentials, setCredentials] = useState<HarvestedCredential[]>([]);
  const [credentialKey, setCredentialKey] = useState<string>();
  const [items, setItems] = useState<DiscoveredItem[] | null>(null);
  const [currentStepId, setCurrentStepId] = useState<string>();
  const [parent, setParent] = useState<DiscoveredItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftovers, setLeftovers] = useState<DiscoveryLeftover[]>([]);

  const isCredentialMode = provider === CREDENTIAL_PROVIDER;
  const entry = catalog.find((p) => p.provider === provider);
  const rootStep = entry?.steps.find((s) => !s.parentStepId);
  const childStep = entry?.steps.find((s) => s.parentStepId);

  useEffect(() => {
    if (!open) return;
    apiGet<ProviderCatalogEntry[]>('/resource-discovery/providers')
      .then(setCatalog)
      .catch(() => setCatalog([]));
    apiGet<InstanceRow[]>('/instances?_start=0&_end=100')
      .then((rows) => {
        setInstances(rows);
        // Pré-sélection : scope d'instance global, sinon l'unique instance
        if (scope && rows.some((row) => row.id === scope)) setInstanceId(scope);
        else if (rows.length === 1) setInstanceId(rows[0].id);
      })
      .catch(() => setInstances([]));
  }, [open, scope]);

  useEffect(() => {
    if (!open || !provider) return;
    setCredentials([]);
    setCredentialKey(undefined);
    setItems(null);
    setParent(null);
    const scopeQuery = instanceId ? `&instanceId=${encodeURIComponent(instanceId)}` : '';
    // En mode credential, aucun type n'est imposé : ce sont elles qu'on vient chercher.
    const providerQuery = isCredentialMode ? '' : `provider=${encodeURIComponent(provider)}`;
    apiGet<HarvestedCredential[]>(`/resource-discovery/credentials?${providerQuery}${scopeQuery}`)
      .then((rows) => {
        setCredentials(rows);
        if (rows[0]) setCredentialKey(`${rows[0].type}:${rows[0].id}`);
      })
      .catch(() => setCredentials([]));
  }, [open, provider, instanceId, isCredentialMode]);

  const refreshLeftovers = useCallback(async (id?: string) => {
    if (!id) return setLeftovers([]);
    await apiGet<DiscoveryLeftover[]>(`/resource-discovery/leftovers?instanceId=${encodeURIComponent(id)}`)
      .then(setLeftovers)
      .catch(() => setLeftovers([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshLeftovers(instanceId);
  }, [open, instanceId, refreshLeftovers]);

  const drop = useCallback(
    async (leftover: DiscoveryLeftover) => {
      try {
        await apiDelete(
          `/resource-discovery/leftovers/${encodeURIComponent(leftover.externalId)}?instanceId=${encodeURIComponent(instanceId ?? '')}`,
        );
        setLeftovers((rows) => rows.filter((row) => row.externalId !== leftover.externalId));
        message.success('Workflow temporaire supprimé');
      } catch (err) {
        message.error((err as Error).message);
      }
    },
    [instanceId],
  );

  const run = useCallback(
    async (stepId: string, parentItem: DiscoveredItem | null) => {
      const credential = credentials.find((c) => `${c.type}:${c.id}` === credentialKey);
      if (!instanceId || !credential) return;
      setLoading(true);
      setError(null);
      try {
        const result = await apiPost<{ items: DiscoveredItem[] }>('/resource-discovery/discover', {
          instanceId,
          provider,
          stepId,
          credentialType: credential.type,
          credentialId: credential.id,
          credentialName: credential.name,
          parentId: parentItem?.id,
          // Échec = le workflow reste dans n8n, dans l'état où il a planté.
          keepOnError: true,
        });
        setItems(result.items);
        setCurrentStepId(stepId);
        setParent(parentItem);
      } catch (err) {
        setError((err as Error).message);
        await refreshLeftovers(instanceId);
      } finally {
        setLoading(false);
      }
    },
    [credentials, credentialKey, instanceId, provider, refreshLeftovers],
  );

  /** Un bouton « + env » par env déclaré : même geste pour une base découverte ou une credential. */
  const envPicks = (item: DiscoveredItem) =>
    envs.map((env) => (
      <Button
        key={env.id}
        size="small"
        onClick={() => {
          onPick(item, env.id);
          message.success(`${item.suggestedKey} · ${env.label} ← ${item.id}`);
        }}
      >
        + {env.label}
      </Button>
    ));

  return (
    <Drawer title="Parcourir depuis n8n" width={640} open={open} onClose={onClose}>
      {!entry && !isCredentialMode ? (
        <Alert
          type="warning"
          showIcon
          message="Provider non découvrable"
          description={`La découverte couvre : ${catalog.map((p) => p.provider).join(', ') || '…'}. Sélectionne d'abord un provider supporté dans le formulaire.`}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Select
              placeholder="Instance n8n"
              style={{ minWidth: 200 }}
              value={instanceId}
              onChange={setInstanceId}
              options={instances.map((i) => ({ value: i.id, label: i.name }))}
            />
            {!isCredentialMode && (
              <Select
                placeholder="Credential"
                style={{ minWidth: 260 }}
                value={credentialKey}
                onChange={setCredentialKey}
                options={credentials.map((c) => ({
                  value: `${c.type}:${c.id}`,
                  label: `${c.name ?? c.id} (${c.type}, ${c.usedBy} nœud${c.usedBy > 1 ? 's' : ''})`,
                }))}
              />
            )}
          </Space>

          {credentials.length === 0 && (
            <Typography.Text type="secondary">
              Aucun credential {isCredentialMode ? '' : `${provider} `}trouvé dans les workflows snapshotés de
              cette instance — synchronise d&apos;abord les workflows, ou vérifie le provider.
            </Typography.Text>
          )}

          <Space>
            {rootStep && (
              <Button
                type="primary"
                disabled={!instanceId || !credentialKey}
                loading={loading}
                onClick={() => run(rootStep.id, null)}
              >
                Lister les {rootStep.label.toLowerCase()}
              </Button>
            )}
            {parent && rootStep && (
              <Button icon={<ArrowLeftOutlined />} onClick={() => run(rootStep.id, null)}>
                Retour aux {rootStep.label.toLowerCase()}
              </Button>
            )}
          </Space>

          {error && (
            <Alert
              type="error"
              showIcon
              message="La découverte a échoué"
              description={
                <Space direction="vertical" size={4}>
                  <Typography.Text>{error}</Typography.Text>
                  <Typography.Text type="secondary">
                    Le workflow temporaire a été conservé dans n8n, dans l&apos;état où il a planté : son
                    exécution est ci-dessous, supprime-le une fois le problème compris.
                  </Typography.Text>
                </Space>
              }
            />
          )}

          {leftovers.length > 0 && (
            <List
              size="small"
              header={
                <Typography.Text strong>
                  Workflows de découverte conservés ({leftovers.length})
                </Typography.Text>
              }
              bordered
              dataSource={leftovers}
              renderItem={(leftover) => (
                <List.Item
                  actions={[
                    <a key="open" href={leftover.url} target="_blank" rel="noopener noreferrer">
                      Ouvrir dans n8n
                    </a>,
                    // La suppression a lieu DANS n8n, pas dans la plateforme : c'est
                    // le seul geste de cet écran dont l'effet sort d'ici, et il ne
                    // se défait pas. Il se confirme, et la confirmation le dit.
                    <Popconfirm
                      key="drop"
                      title="Supprimer ce workflow dans n8n ?"
                      description={`« ${leftover.name} » sera supprimé de l'instance n8n. Irréversible.`}
                      okText="Supprimer dans n8n"
                      okButtonProps={{ danger: true }}
                      cancelText="Annuler"
                      onConfirm={() => drop(leftover)}
                    >
                      <Button size="small" danger>
                        Supprimer
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={4}>
                        <Typography.Text>{leftover.name}</Typography.Text>
                        {leftover.active && <Tag color="red">actif</Tag>}
                      </Space>
                    }
                    description={
                      leftover.lastExecution ? (
                        <Space direction="vertical" size={2}>
                          <Space size={4}>
                            <Tag color={leftover.lastExecution.status === 'error' ? 'red' : 'default'}>
                              {leftover.lastExecution.status}
                            </Tag>
                            {leftover.lastExecution.failedNode && (
                              <Typography.Text type="secondary">
                                nœud {leftover.lastExecution.failedNode}
                              </Typography.Text>
                            )}
                            <a href={leftover.lastExecution.url} target="_blank" rel="noopener noreferrer">
                              Voir l&apos;exécution
                            </a>
                          </Space>
                          {leftover.lastExecution.message && (
                            <Typography.Text type="danger">{leftover.lastExecution.message}</Typography.Text>
                          )}
                        </Space>
                      ) : (
                        <Typography.Text type="secondary">
                          Aucune exécution — l&apos;échec est en amont (activation ou webhook injoignable).
                        </Typography.Text>
                      )
                    }
                  />
                </List.Item>
              )}
            />
          )}

          {parent && (
            <Typography.Text>
              {childStep?.label} de <strong>{parent.name}</strong> <Tag>{parent.id}</Tag>
            </Typography.Text>
          )}

          {isCredentialMode ? (
            <>
              <Typography.Paragraph type="secondary">
                Les credentials relevées dans les workflows snapshotés — l&apos;API n8n ne les liste pas.
                Choisis celle de chaque env : le nom retenu ici remet à jour le libellé affiché par le nœud
                après la bascule.
              </Typography.Paragraph>
              {credentials.length > 0 && (
                <List
                  size="small"
                  dataSource={credentials}
                  renderItem={(credential) => (
                    <List.Item
                      actions={envPicks({
                        id: credential.id,
                        name: credential.name ?? credential.id,
                        suggestedKey: credentialKeyOf(credential.type),
                      })}
                    >
                      <List.Item.Meta
                        title={credential.name ?? credential.id}
                        description={
                          <Space size={4} wrap>
                            <Tag>{credential.type}</Tag>
                            <Typography.Text code copyable={{ text: credential.id }}>
                              {credential.id}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                              {credential.usedBy} nœud{credential.usedBy > 1 ? 's' : ''}
                            </Typography.Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </>
          ) : (
            <Spin spinning={loading}>
              {items === null ? (
                <Typography.Paragraph type="secondary">
                  Un workflow temporaire « [NWM discovery] » est créé sur l&apos;instance, appelé, puis
                  supprimé — sauf en cas d&apos;erreur, où il est gardé pour que tu puisses l&apos;ouvrir dans
                  n8n et comprendre.
                </Typography.Paragraph>
              ) : items.length === 0 ? (
                <Empty description="Aucun résultat" />
              ) : (
                <List
                  size="small"
                  dataSource={items}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        ...envPicks(item),
                        ...(childStep && currentStepId === rootStep?.id
                          ? [
                              <Button
                                key="drill"
                                size="small"
                                icon={<TableOutlined />}
                                onClick={() => run(childStep.id, item)}
                              >
                                {childStep.label}
                              </Button>,
                            ]
                          : []),
                      ]}
                    >
                      <List.Item.Meta
                        title={item.name}
                        description={
                          <Typography.Text code copyable={{ text: item.id }}>
                            {item.id}
                          </Typography.Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Spin>
          )}
        </Space>
      )}
    </Drawer>
  );
}
