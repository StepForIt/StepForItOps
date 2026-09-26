'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, List, Modal, Spin, Tag, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  InfoCircleOutlined,
  MinusCircleTwoTone,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { BRAND } from '../../lib/brand/colors';

interface ChecklistStep {
  key: string;
  label: string;
  done: boolean | null;
  detail?: string;
  help?: string;
  action?: 'create-monitor' | 'enable-monitor' | 'provision-kuma' | 'run-check';
}

interface InstanceChecklist {
  instanceId: string;
  instanceName: string;
  monitorId?: string;
  steps: ChecklistStep[];
}

const ACTION_LABELS = {
  'create-monitor': 'createMonitor',
  'enable-monitor': 'enableMonitor',
  'provision-kuma': 'provisionKuma',
  'run-check': 'runCheck',
} as const satisfies Record<NonNullable<ChecklistStep['action']>, string>;

/** Checklist de migration monitoring d'une instance (étapes faites / à faire + actions). */
export function MonitoringChecklistModal({
  instanceId,
  instanceName,
  onClose,
}: {
  instanceId: string | null;
  instanceName?: string;
  onClose: () => void;
}) {
  const t = useTranslations('settings.monitoringChecklist');
  const tc = useTranslations('common');
  const [checklist, setChecklist] = useState<InstanceChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!instanceId) return;
    setError(null);
    apiGet<InstanceChecklist>(`/monitoring/instance-checklist/${instanceId}`)
      .then(setChecklist)
      .catch((e) => setError((e as Error).message));
  }, [instanceId]);

  useEffect(() => {
    setChecklist(null);
    load();
  }, [load]);

  const runAction = async (step: ChecklistStep) => {
    if (!checklist || !step.action) return;
    setBusyStep(step.key);
    try {
      if (step.action === 'create-monitor') {
        await apiPost('/monitors', {
          name: t('monitorName', { name: checklist.instanceName }),
          kind: 'error-watch',
          enabled: true,
          config: { instanceId: checklist.instanceId, intervalSeconds: 120 },
        });
      } else if (step.action === 'enable-monitor') {
        await apiPatch(`/monitors/${checklist.monitorId}`, { enabled: true });
      } else if (step.action === 'provision-kuma') {
        await apiPost(`/monitors/${checklist.monitorId}/provision`);
      } else if (step.action === 'run-check') {
        const result = await apiPost<{ status: string }>(`/monitors/${checklist.monitorId}/check`);
        message.info(t('checkResult', { status: result.status }));
      }
      message.success(t('done'));
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <Modal
      title={t('title', { name: checklist?.instanceName ?? instanceName ?? '' })}
      open={instanceId !== null}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{tc('close')}</Button>}
      width={720}
    >
      {error && <Alert type="error" showIcon message={t('unavailable')} description={error} />}
      {!error && !checklist && <Spin />}
      {checklist && (
        <List
          dataSource={checklist.steps}
          renderItem={(step) => (
            <List.Item
              actions={
                step.action
                  ? [
                      <Button
                        key="action"
                        size="small"
                        type="primary"
                        loading={busyStep === step.key}
                        onClick={() => runAction(step)}
                      >
                        {t(`actions.${ACTION_LABELS[step.action]}`)}
                      </Button>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                avatar={
                  step.done === true ? (
                    <CheckCircleTwoTone twoToneColor={BRAND.success} style={{ fontSize: 20 }} />
                  ) : step.done === false ? (
                    <CloseCircleTwoTone twoToneColor={BRAND.danger} style={{ fontSize: 20 }} />
                  ) : (
                    <MinusCircleTwoTone twoToneColor={BRAND.slateLight} style={{ fontSize: 20 }} />
                  )
                }
                title={
                  <>
                    {step.label}{' '}
                    {step.help && (
                      <Tooltip
                        title={step.help}
                        overlayStyle={{ maxWidth: 420 }}
                        overlayInnerStyle={{ fontSize: 12, lineHeight: 1.6, padding: 12 }}
                      >
                        <InfoCircleOutlined
                          style={{ color: BRAND.primary, cursor: 'help' }}
                          aria-label={t('helpLabel', { label: step.label })}
                        />
                      </Tooltip>
                    )}{' '}
                    {step.done === null && <Tag>{t('manual')}</Tag>}
                  </>
                }
                description={
                  step.detail && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {step.detail}
                    </Typography.Text>
                  )
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
