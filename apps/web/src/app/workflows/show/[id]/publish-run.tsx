'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, List, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';

/** Miroir de `PublicationStep` (@nwm/core) : le web ne dépend pas du domaine. */
export interface PublishRunStep {
  instanceId: string;
  env?: string | null;
  externalId?: string;
  name: string;
  sourceName: string;
  state: 'pending' | 'done' | 'already' | 'kept-draft' | 'not-applicable' | 'failed' | 'skipped';
  reason?: string;
}

export interface PublishRunView {
  id: string;
  status: 'running' | 'paused' | 'done' | 'abandoned';
  steps: PublishRunStep[];
}

type StateLabel = 'pending' | 'done' | 'already' | 'keptDraft' | 'notApplicable' | 'failed' | 'skipped';

const STATE: Record<PublishRunStep['state'], { label: StateLabel; color?: string }> = {
  pending: { label: 'pending' },
  done: { label: 'done', color: 'green' },
  already: { label: 'already', color: 'green' },
  'kept-draft': { label: 'keptDraft' },
  'not-applicable': { label: 'notApplicable' },
  failed: { label: 'failed', color: 'red' },
  skipped: { label: 'skipped', color: 'orange' },
};

export type PublishRunT = ReturnType<typeof useTranslations<'workflowShow.publishRun'>>;

/** Résumé d'une ligne, pour le message qui suit la promotion. */
export function publishRunSummary(run: PublishRunView, t: PublishRunT): string {
  const published = run.steps.filter((step) => step.state === 'done').length;
  if (run.status === 'paused') {
    const failed = run.steps.find((step) => step.state === 'failed');
    return t('pausedOn', { name: failed?.name ?? '', reason: failed?.reason ?? t('n8nRefusal') });
  }
  return published > 0 ? t('published', { count: published }) : t('nothing');
}

function PublishRunPanel({
  run,
  onChange,
}: {
  run: PublishRunView;
  onChange: (run: PublishRunView) => void;
}) {
  const t = useTranslations('workflowShow.publishRun');
  const [busy, setBusy] = useState<'resume' | 'skip' | 'abandon' | null>(null);
  const act = async (action: 'resume' | 'skip' | 'abandon') => {
    setBusy(action);
    try {
      const next = await apiPost<PublishRunView>(`/env-switcher/publish-runs/${run.id}/${action}`);
      onChange(next);
      if (next.status === 'paused') message.error(publishRunSummary(next, t), 10);
      else if (next.status === 'done') message.success(publishRunSummary(next, t));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const failed = run.steps.find((step) => step.state === 'failed');

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {failed && (
        <Alert
          type="error"
          showIcon
          message={t('refused', { name: failed.name })}
          description={failed.reason}
        />
      )}
      <List
        size="small"
        dataSource={run.steps}
        renderItem={(step) => (
          <List.Item>
            <Space wrap>
              <Tag color={STATE[step.state].color}>{t(`states.${STATE[step.state].label}`)}</Tag>
              <span>{step.name}</span>
              {step.env && <Tag>{step.env.toUpperCase()}</Tag>}
              {step.state === 'not-applicable' && step.reason && (
                <Typography.Text type="secondary">{step.reason}</Typography.Text>
              )}
            </Space>
          </List.Item>
        )}
      />
      {run.status === 'paused' && (
        <Space wrap>
          <Button type="primary" loading={busy === 'resume'} onClick={() => act('resume')}>
            {t('resume')}
          </Button>
          <Popconfirm title={t('skipTitle')} description={t('skipDescription')} onConfirm={() => act('skip')}>
            <Button loading={busy === 'skip'}>{t('skip')}</Button>
          </Popconfirm>
          <Popconfirm title={t('abandonTitle')} onConfirm={() => act('abandon')}>
            <Button danger loading={busy === 'abandon'}>
              {t('abandon')}
            </Button>
          </Popconfirm>
        </Space>
      )}
    </Space>
  );
}

/**
 * Bandeau de la fiche : une chaîne « publier comme la source » en pause sur ce
 * workflow (source ou cible). `pushed` est la chaîne que la promotion vient de
 * rendre : en pause, elle s'ouvre d'elle-même.
 */
export function PublishRunBanner({
  workflowId,
  pushed,
}: {
  workflowId: string;
  pushed?: PublishRunView | null;
}) {
  const t = useTranslations('workflowShow.publishRun');
  const tCommon = useTranslations('common');
  const [run, setRun] = useState<PublishRunView | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apiGet<{ run: PublishRunView | null }>(
      `/env-switcher/publish-runs?workflowId=${encodeURIComponent(workflowId)}`,
    )
      .then((response) => setRun(response.run))
      .catch(() => setRun(null));
  }, [workflowId]);

  useEffect(() => {
    if (!pushed) return;
    setRun(pushed);
    setOpen(pushed.status === 'paused');
  }, [pushed]);

  if (!run) return null;
  const visible = run.status === 'paused' || run.status === 'running';

  return (
    <>
      {visible && (
        <Alert
          type={run.status === 'paused' ? 'error' : 'info'}
          showIcon
          message={run.status === 'paused' ? t('paused') : t('running')}
          action={
            <Button size="small" onClick={() => setOpen(true)}>
              {tCommon('see')}
            </Button>
          }
        />
      )}
      <Modal title={t('modalTitle')} open={open} onCancel={() => setOpen(false)} footer={null}>
        <PublishRunPanel run={run} onChange={setRun} />
      </Modal>
    </>
  );
}
