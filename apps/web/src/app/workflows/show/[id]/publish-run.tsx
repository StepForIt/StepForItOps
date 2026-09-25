'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, List, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd';
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

const STATE: Record<PublishRunStep['state'], { label: string; color?: string }> = {
  pending: { label: 'à publier' },
  done: { label: 'publié', color: 'green' },
  already: { label: 'déjà publié', color: 'green' },
  'kept-draft': { label: 'brouillon en source' },
  'not-applicable': { label: 'ignoré' },
  failed: { label: 'refusé', color: 'red' },
  skipped: { label: 'passé', color: 'orange' },
};

/** Résumé d'une ligne, pour le message qui suit la promotion. */
export function publishRunSummary(run: PublishRunView): string {
  const published = run.steps.filter((step) => step.state === 'done').length;
  if (run.status === 'paused') {
    const failed = run.steps.find((step) => step.state === 'failed');
    return `Publication en pause sur « ${failed?.name} » : ${failed?.reason ?? 'refus de n8n'}`;
  }
  return published > 0 ? `${published} workflow(s) publié(s) comme la source` : 'Rien à publier';
}

function PublishRunPanel({
  run,
  onChange,
}: {
  run: PublishRunView;
  onChange: (run: PublishRunView) => void;
}) {
  const [busy, setBusy] = useState<'resume' | 'skip' | 'abandon' | null>(null);
  const act = async (action: 'resume' | 'skip' | 'abandon') => {
    setBusy(action);
    try {
      const next = await apiPost<PublishRunView>(`/env-switcher/publish-runs/${run.id}/${action}`);
      onChange(next);
      if (next.status === 'paused') message.error(publishRunSummary(next), 10);
      else if (next.status === 'done') message.success(publishRunSummary(next));
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
        <Alert type="error" showIcon message={`« ${failed.name} » refusé`} description={failed.reason} />
      )}
      <List
        size="small"
        dataSource={run.steps}
        renderItem={(step) => (
          <List.Item>
            <Space wrap>
              <Tag color={STATE[step.state].color}>{STATE[step.state].label}</Tag>
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
            Reprendre
          </Button>
          <Popconfirm
            title="Passer cette étape ?"
            description="Les workflows qui l’appellent seront sans doute refusés à leur tour."
            onConfirm={() => act('skip')}
          >
            <Button loading={busy === 'skip'}>Passer</Button>
          </Popconfirm>
          <Popconfirm title="Abandonner la publication ?" onConfirm={() => act('abandon')}>
            <Button danger loading={busy === 'abandon'}>
              Abandonner
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
          message={run.status === 'paused' ? 'Publication en pause' : 'Publication en cours'}
          action={
            <Button size="small" onClick={() => setOpen(true)}>
              Voir
            </Button>
          }
        />
      )}
      <Modal title="Publier comme la source" open={open} onCancel={() => setOpen(false)} footer={null}>
        <PublishRunPanel run={run} onChange={setRun} />
      </Modal>
    </>
  );
}
