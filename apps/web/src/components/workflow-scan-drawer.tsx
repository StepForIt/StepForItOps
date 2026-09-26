'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useInvalidate } from '@refinedev/core';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  List,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { ScanOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../lib/api';
import { useInstanceScope } from '../lib/instance-scope';
import { useEnvColor, useEnvs } from '../lib/envs';

interface MappingHit {
  mappingId: string;
  logicalName: string;
  env: string;
  key: string;
}

interface ScannedId {
  id: string;
  suggestedKey: string;
  mapping?: MappingHit;
}

interface ScannedResource {
  provider: string;
  groupKey: string;
  label?: string;
  nodeNames: string[];
  workflows: string[];
  ids: ScannedId[];
}

interface ScannedCredential {
  type: string;
  id: string;
  name?: string;
  nodeNames: string[];
  workflows: string[];
  mapping?: MappingHit;
}

/** Forme commune de /workflow-scan et /group-scan (workflowCount seulement côté groupe). */
interface ScanResult {
  detectedEnv: string | null;
  workflowCount?: number;
  resources: ScannedResource[];
  credentials: ScannedCredential[];
}

interface InstanceRow {
  id: string;
  name: string;
}

interface WorkflowRow {
  id: string;
  name: string;
}

interface GroupRow {
  id: string;
  name: string;
  workflowIds: string[];
}

/** Statut d'un id : mapping existant qui le contient, ou "non mappé". */
function MappedTag({ mapping }: { mapping?: MappingHit }) {
  const envColor = useEnvColor();
  const t = useTranslations('chat.scan');
  if (!mapping) return <Tag color="orange">{t('unmapped')}</Tag>;
  return (
    <Tag color={envColor(mapping.env)}>
      {mapping.logicalName} · {mapping.env}
    </Tag>
  );
}

/** Clés uniques pour les ids non mappés d'un groupe (suffixe en cas de collision de slug). */
function unmappedValues(ids: ScannedId[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { id, suggestedKey, mapping } of ids) {
    if (mapping) continue;
    let key = suggestedKey;
    for (let n = 2; values[key]; n++) key = `${suggestedKey}_${n}`;
    values[key] = id;
  }
  return values;
}

/**
 * Drawer « Découvrir depuis un workflow » : scanne les ressources/credentials référencés
 * par un workflow (ou tous ceux d'un groupe) et crée les mappings manquants,
 * pré-remplis pour l'env choisi.
 */
export function WorkflowScanDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('chat.scan');
  const { envs } = useEnvs();
  const envColor = useEnvColor();
  const { scope } = useInstanceScope();
  const invalidate = useInvalidate();
  const [mode, setMode] = useState<'workflow' | 'group'>('workflow');
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [instanceId, setInstanceId] = useState<string>();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [workflowId, setWorkflowId] = useState<string>();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupId, setGroupId] = useState<string>();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [env, setEnv] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string>();

  useEffect(() => {
    if (!open) return;
    apiGet<InstanceRow[]>('/instances?_start=0&_end=100')
      .then((rows) => {
        setInstances(rows);
        if (scope && rows.some((row) => row.id === scope)) setInstanceId(scope);
        else if (rows.length === 1) setInstanceId(rows[0].id);
      })
      .catch(() => setInstances([]));
  }, [open, scope]);

  useEffect(() => {
    if (!open || !instanceId) return;
    setWorkflows([]);
    setWorkflowId(undefined);
    setGroups([]);
    setGroupId(undefined);
    setResult(null);
    apiGet<WorkflowRow[]>(
      `/workflows?_start=0&_end=500&_sort=name&_order=asc&instanceId=${encodeURIComponent(instanceId)}`,
    )
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
    apiGet<GroupRow[]>(
      `/workflow-groups?_start=0&_end=200&_sort=name&_order=asc&instanceId=${encodeURIComponent(instanceId)}`,
    )
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [open, instanceId]);

  const scan = useCallback(async () => {
    const query =
      mode === 'workflow'
        ? workflowId && `/resource-discovery/workflow-scan?workflowId=${encodeURIComponent(workflowId)}`
        : groupId && `/resource-discovery/group-scan?groupId=${encodeURIComponent(groupId)}`;
    if (!query) return;
    setLoading(true);
    try {
      const scanned = await apiGet<ScanResult>(query);
      setResult(scanned);
      setEnv(scanned.detectedEnv ?? undefined);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode, workflowId, groupId]);

  const createMapping = useCallback(
    async (key: string, body: { provider: string; logicalName: string; values: Record<string, string> }) => {
      if (!env) return;
      setCreating(key);
      try {
        await apiPost('/resource-mappings', {
          provider: body.provider,
          logicalName: body.logicalName,
          values: { [env]: body.values },
        });
        message.success(t('mappingCreated', { name: body.logicalName, env }));
        invalidate({ resource: 'resource-mappings', invalidates: ['list'] });
        await scan();
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        setCreating(undefined);
      }
    },
    [env, invalidate, scan, t],
  );

  const envSelect = (
    <Select
      placeholder={t('envPlaceholder')}
      style={{ minWidth: 160 }}
      value={env}
      onChange={setEnv}
      options={envs.map((item) => ({ value: item.id, label: item.label }))}
    />
  );

  return (
    <Drawer title={t('title')} width={720} open={open} onClose={onClose}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(value) => {
              setMode(value as 'workflow' | 'group');
              setResult(null);
            }}
            options={[
              { value: 'workflow', label: t('mode.workflow') },
              { value: 'group', label: t('mode.group') },
            ]}
          />
          <Select
            placeholder={t('instancePlaceholder')}
            style={{ minWidth: 180 }}
            value={instanceId}
            onChange={setInstanceId}
            options={instances.map((i) => ({ value: i.id, label: i.name }))}
          />
          {mode === 'workflow' ? (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('workflowPlaceholder')}
              style={{ minWidth: 280 }}
              value={workflowId}
              onChange={setWorkflowId}
              options={workflows.map((w) => ({ value: w.id, label: w.name }))}
            />
          ) : (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={groups.length === 0 ? t('noGroups') : t('groupPlaceholder')}
              style={{ minWidth: 280 }}
              value={groupId}
              onChange={setGroupId}
              options={groups.map((g) => ({
                value: g.id,
                label: t('groupOption', { name: g.name, count: g.workflowIds.length }),
              }))}
            />
          )}
          <Button
            type="primary"
            icon={<ScanOutlined />}
            disabled={mode === 'workflow' ? !workflowId : !groupId}
            loading={loading}
            onClick={scan}
          >
            {t('scan')}
          </Button>
        </Space>

        {result === null ? (
          <Typography.Paragraph type="secondary">{t('intro')}</Typography.Paragraph>
        ) : (
          <Spin spinning={loading}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {result.detectedEnv ? (
                <Alert
                  type="info"
                  showIcon
                  message={t.rich('detectedEnv', {
                    env: () => <Tag color={envColor(result.detectedEnv!)}>{result.detectedEnv}</Tag>,
                    select: () => envSelect,
                  })}
                />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={t.rich('noDetectedEnv', { select: () => envSelect })}
                />
              )}

              {result.workflowCount !== undefined && (
                <Typography.Text type="secondary">
                  {t('workflowCount', { count: result.workflowCount })}
                </Typography.Text>
              )}

              <Typography.Title level={5} style={{ margin: 0 }}>
                {t('resources', { count: result.resources.length })}
              </Typography.Title>
              {result.resources.length === 0 ? (
                <Empty description={t('noResources')} />
              ) : (
                <List
                  size="small"
                  dataSource={result.resources}
                  renderItem={(resource) => {
                    const values = unmappedValues(resource.ids);
                    const pending = Object.keys(values).length;
                    return (
                      <List.Item
                        actions={
                          pending > 0
                            ? [
                                <Button
                                  key="create"
                                  size="small"
                                  icon={<PlusOutlined />}
                                  disabled={!env}
                                  loading={creating === resource.groupKey}
                                  onClick={() =>
                                    createMapping(resource.groupKey, {
                                      provider: resource.provider,
                                      logicalName: resource.label ?? resource.groupKey,
                                      values,
                                    })
                                  }
                                >
                                  {t('createMapping')}
                                </Button>,
                              ]
                            : []
                        }
                      >
                        <List.Item.Meta
                          title={
                            <Space wrap>
                              <Tag>{resource.provider}</Tag>
                              {resource.label ?? resource.groupKey}
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              {mode === 'group' && (
                                <Typography.Text type="secondary">
                                  {t('workflows', { list: resource.workflows.join(', ') })}
                                </Typography.Text>
                              )}
                              <Typography.Text type="secondary">
                                {t('nodes', { list: resource.nodeNames.join(', ') })}
                              </Typography.Text>
                              {resource.ids.map((id) => (
                                <Space key={id.id} wrap>
                                  <Typography.Text code>{id.suggestedKey}</Typography.Text>
                                  <Typography.Text code copyable={{ text: id.id }}>
                                    {id.id}
                                  </Typography.Text>
                                  <MappedTag mapping={id.mapping} />
                                </Space>
                              ))}
                            </Space>
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              )}

              <Typography.Title level={5} style={{ margin: 0 }}>
                {t('credentials', { count: result.credentials.length })}
              </Typography.Title>
              {result.credentials.length === 0 ? (
                <Empty description={t('noCredentials')} />
              ) : (
                <List
                  size="small"
                  dataSource={result.credentials}
                  renderItem={(credential) => (
                    <List.Item
                      actions={
                        credential.mapping
                          ? []
                          : [
                              <Button
                                key="create"
                                size="small"
                                icon={<PlusOutlined />}
                                disabled={!env}
                                loading={creating === `${credential.type}:${credential.id}`}
                                onClick={() =>
                                  createMapping(`${credential.type}:${credential.id}`, {
                                    provider: 'credential',
                                    logicalName: credential.name ?? `${credential.type} ${credential.id}`,
                                    values: { credentialId: credential.id },
                                  })
                                }
                              >
                                {t('createMapping')}
                              </Button>,
                            ]
                      }
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <Tag>{credential.type}</Tag>
                            {credential.name ?? credential.id}
                          </Space>
                        }
                        description={
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space wrap>
                              <Typography.Text code copyable={{ text: credential.id }}>
                                {credential.id}
                              </Typography.Text>
                              <MappedTag mapping={credential.mapping} />
                            </Space>
                            {mode === 'group' && (
                              <Typography.Text type="secondary">
                                {t('workflows', { list: credential.workflows.join(', ') })}
                              </Typography.Text>
                            )}
                            <Typography.Text type="secondary">
                              {t('nodes', { list: credential.nodeNames.join(', ') })}
                            </Typography.Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Space>
          </Spin>
        )}
      </Space>
    </Drawer>
  );
}
