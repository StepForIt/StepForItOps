'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Checkbox, List, Modal, Select, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiPost } from '../lib/api';
import { useEnvColor, useEnvs } from '../lib/envs';
import { SwitchedResource, SwitchedResources } from './switched-resources';

interface UnmappedResource {
  key: string;
  provider: string;
  label?: string;
  nodes: string[];
}

interface GroupCopyPreview {
  workflowId: string;
  name: string;
  targetName: string;
  alreadyExists: boolean;
  sameAsSource: boolean;
  active: boolean;
  archived: boolean;
  replacements: number;
  switched?: SwitchedResource[];
  unmapped: UnmappedResource[];
  internalCalls: string[];
  externalCalls: string[];
}

interface GroupDuplicatePreview {
  groupName: string;
  targetEnv: string;
  targetGroupName: string;
  targetGroupExists: boolean;
  copies: GroupCopyPreview[];
  duplicateCount: number;
}

interface GroupCopyResult {
  sourceWorkflowId: string;
  sourceName: string;
  newName: string;
  newN8nId?: string;
  replacements: number;
  switched?: SwitchedResource[];
}

interface GroupDuplicateResult {
  groupName: string;
  targetEnv: string;
  targetGroupName: string;
  copies: GroupCopyResult[];
}

/**
 * Duplication d'un groupe vers un env, avec le même écran d'impact qu'un workflow
 * seul : ce qui sera créé, ce que les mappings basculeront, ce qu'ils ne couvrent
 * pas, et surtout les copies qui existent DÉJÀ — la duplication crée sans apparier,
 * donc un second clic double le groupe entier sans rien dire.
 */
export function GroupDuplicateModal({
  groupId,
  groupName,
  open,
  onClose,
}: {
  groupId: string;
  groupName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('settings.groupDuplicate');
  const tc = useTranslations('common');
  const { envs } = useEnvs();
  const envColor = useEnvColor();
  const [env, setEnv] = useState<string>('');
  const [preview, setPreview] = useState<GroupDuplicatePreview | null>(null);
  const [result, setResult] = useState<GroupDuplicateResult | null>(null);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadPreview = useCallback(() => {
    setLoading(true);
    setPreview(null);
    apiPost<GroupDuplicatePreview>(`/env-switcher/duplicate-group/${groupId}/preview`, { targetEnv: env })
      .then(setPreview)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [groupId, env]);

  // L'env cible part du premier env déclaré : la liste n'est plus figée à dev/preprod/prod.
  useEffect(() => {
    if (!env && envs.length > 0) setEnv(envs[0].id);
  }, [env, envs]);

  useEffect(() => {
    if (!open || !env) return;
    setResult(null);
    setForce(false);
    loadPreview();
  }, [open, env, loadPreview]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await apiPost<GroupDuplicateResult>(`/env-switcher/duplicate-group/${groupId}`, {
        targetEnv: env,
        force,
      });
      setResult(res);
      message.success(t('done', { count: res.copies.length, env: res.targetEnv }));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const blocked = preview !== null && preview.duplicateCount > 0 && !force;
  const unmappedTotal = preview?.copies.reduce((sum, copy) => sum + copy.unmapped.length, 0) ?? 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('title', { name: groupName })}
      width={760}
      okText={
        result
          ? tc('close')
          : preview
            ? t('duplicateCount', { count: preview.copies.length })
            : t('duplicate')
      }
      cancelText={result ? null : tc('cancel')}
      okButtonProps={{ disabled: !result && (blocked || preview === null), loading: running }}
      cancelButtonProps={{ style: result ? { display: 'none' } : undefined }}
      onOk={result ? onClose : run}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {!result && (
          <Space wrap>
            <Typography.Text type="secondary">{t('targetEnv')}</Typography.Text>
            <Select
              style={{ width: 140 }}
              value={env}
              onChange={(value) => setEnv(value)}
              options={envs.map((item) => ({ value: item.id, label: item.label }))}
            />
          </Space>
        )}

        {result ? (
          <ResultView result={result} envColor={envColor} />
        ) : loading ? (
          <Spin />
        ) : preview ? (
          <>
            <Typography.Text>
              {t.rich('targetGroup', {
                name: preview.targetGroupName,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}{' '}
              <Typography.Text type="secondary">
                {preview.targetGroupExists ? t('existing') : t('new')}
              </Typography.Text>
            </Typography.Text>
            {preview.duplicateCount > 0 && (
              <Alert
                type="warning"
                showIcon
                message={t('alreadyExist', { count: preview.duplicateCount })}
                description={
                  <Checkbox checked={force} onChange={(event) => setForce(event.target.checked)}>
                    {t('force')}
                  </Checkbox>
                }
              />
            )}
            {unmappedTotal > 0 && (
              <Alert
                type="warning"
                showIcon
                message={t('unmapped', { count: unmappedTotal })}
                description={<Link href="/resource-mappings/create">{t('declareMapping')}</Link>}
              />
            )}
            <List
              size="small"
              dataSource={preview.copies}
              renderItem={(copy) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        {copy.name} → <strong>{copy.targetName}</strong>
                        {copy.sameAsSource ? (
                          <Tag color="red">{t('sameEnv')}</Tag>
                        ) : (
                          copy.alreadyExists && <Tag color="red">{t('copyExists')}</Tag>
                        )}
                        {copy.archived && <Tag>{t('archived')}</Tag>}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space wrap>
                          {copy.internalCalls.length > 0 && (
                            <Tooltip title={copy.internalCalls.join(', ')}>
                              <Tag color="blue">
                                {t('internalCalls', { count: copy.internalCalls.length })}
                              </Tag>
                            </Tooltip>
                          )}
                          {copy.externalCalls.length > 0 && (
                            <Tooltip
                              title={t('externalCallsTooltip', { names: copy.externalCalls.join(', ') })}
                            >
                              <Tag color="orange">
                                {t('externalCalls', { count: copy.externalCalls.length })}
                              </Tag>
                            </Tooltip>
                          )}
                          {copy.unmapped.length > 0 && (
                            <Tag color="orange">
                              {copy.unmapped.map((resource) => resource.label ?? resource.key).join(', ')}
                            </Tag>
                          )}
                        </Space>
                        <SwitchedResources switched={copy.switched} replacements={copy.replacements} />
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </>
        ) : null}
      </Space>
    </Modal>
  );
}

function ResultView({
  result,
  envColor,
}: {
  result: GroupDuplicateResult;
  envColor: (env: string | null | undefined) => string;
}) {
  const t = useTranslations('settings.groupDuplicate');
  return (
    <>
      <Alert
        type="success"
        showIcon
        message={
          <>
            {t.rich('attached', {
              name: result.targetGroupName,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}{' '}
            <Tag color={envColor(result.targetEnv)}>{result.targetEnv}</Tag>
          </>
        }
      />
      <List
        size="small"
        dataSource={result.copies}
        renderItem={(copy) => (
          <List.Item>
            <List.Item.Meta
              title={
                <Space wrap>
                  {copy.sourceName} → <strong>{copy.newName}</strong>
                </Space>
              }
              description={
                <>
                  {!copy.newN8nId && <Tag color="red">{t('creationFailed')}</Tag>}
                  <SwitchedResources switched={copy.switched} replacements={copy.replacements} />
                </>
              }
            />
          </List.Item>
        )}
      />
    </>
  );
}
