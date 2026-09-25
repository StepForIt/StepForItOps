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
  if (!mapping) return <Tag color="orange">non mappé</Tag>;
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
        message.success(`Mapping « ${body.logicalName} » créé (${env})`);
        invalidate({ resource: 'resource-mappings', invalidates: ['list'] });
        await scan();
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        setCreating(undefined);
      }
    },
    [env, invalidate, scan],
  );

  const envSelect = (
    <Select
      placeholder="Env des valeurs"
      style={{ minWidth: 160 }}
      value={env}
      onChange={setEnv}
      options={envs.map((item) => ({ value: item.id, label: item.label }))}
    />
  );

  return (
    <Drawer title="Découvrir depuis un workflow" width={720} open={open} onClose={onClose}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(value) => {
              setMode(value as 'workflow' | 'group');
              setResult(null);
            }}
            options={[
              { value: 'workflow', label: 'Workflow' },
              { value: 'group', label: 'Groupe' },
            ]}
          />
          <Select
            placeholder="Instance n8n"
            style={{ minWidth: 180 }}
            value={instanceId}
            onChange={setInstanceId}
            options={instances.map((i) => ({ value: i.id, label: i.name }))}
          />
          {mode === 'workflow' ? (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Workflow"
              style={{ minWidth: 280 }}
              value={workflowId}
              onChange={setWorkflowId}
              options={workflows.map((w) => ({ value: w.id, label: w.name }))}
            />
          ) : (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={groups.length === 0 ? 'Aucun groupe sur cette instance' : 'Groupe'}
              style={{ minWidth: 280 }}
              value={groupId}
              onChange={setGroupId}
              options={groups.map((g) => ({
                value: g.id,
                label: `${g.name} (${g.workflowIds.length} wf)`,
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
            Scanner
          </Button>
        </Space>

        {result === null ? (
          <Typography.Paragraph type="secondary">
            Le scan liste les bases, tables et credentials référencés par le workflow ou le groupe (snapshots
            locaux, aucun appel n8n), indique ceux déjà couverts par un mapping, et crée les mappings
            manquants pré-remplis avec les valeurs trouvées — pour un seul env : celui des workflows scannés.
          </Typography.Paragraph>
        ) : (
          <Spin spinning={loading}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {result.detectedEnv ? (
                <Alert
                  type="info"
                  showIcon
                  message={
                    <>
                      Env détecté via les mappings existants :{' '}
                      <Tag color={envColor(result.detectedEnv)}>{result.detectedEnv}</Tag>— les valeurs seront
                      rangées dans {envSelect}
                    </>
                  }
                />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={
                    <>
                      Aucun id de ce workflow n&apos;est connu des mappings — choisis l&apos;env auquel
                      appartiennent ses valeurs : {envSelect}
                    </>
                  }
                />
              )}

              {result.workflowCount !== undefined && (
                <Typography.Text type="secondary">
                  {result.workflowCount} workflow{result.workflowCount > 1 ? 's' : ''} scanné
                  {result.workflowCount > 1 ? 's' : ''}.
                </Typography.Text>
              )}

              <Typography.Title level={5} style={{ margin: 0 }}>
                Ressources ({result.resources.length})
              </Typography.Title>
              {result.resources.length === 0 ? (
                <Empty description="Aucune ressource externe détectée" />
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
                                  Créer le mapping
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
                                  Workflows : {resource.workflows.join(', ')}
                                </Typography.Text>
                              )}
                              <Typography.Text type="secondary">
                                Nœuds : {resource.nodeNames.join(', ')}
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
                Credentials ({result.credentials.length})
              </Typography.Title>
              {result.credentials.length === 0 ? (
                <Empty description="Aucun credential détecté" />
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
                                Créer le mapping
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
                                Workflows : {credential.workflows.join(', ')}
                              </Typography.Text>
                            )}
                            <Typography.Text type="secondary">
                              Nœuds : {credential.nodeNames.join(', ')}
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
