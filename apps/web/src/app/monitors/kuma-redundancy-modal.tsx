'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Tag, Tooltip, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';

type RedundancyRule = 'health-webhook' | 'duplicate-error-watch' | 'paused';

interface RedundantProbe {
  externalId: number;
  name: string;
  rule: RedundancyRule;
  reason: string;
  instanceName?: string;
  executionsPerDay?: number;
}

interface RedundancyReview {
  candidates: RedundantProbe[];
  alreadyTagged: number[];
  tagName: string;
}

interface RedundancyTagResult {
  tagName: string;
  tagged: Array<{ externalId: number; name: string }>;
  skipped: Array<{ externalId: number; reason: string }>;
}

/** Couleur de chaque motif (libellé : `health.monitors.redundancy.rules.<rule>`). */
const RULE_LABELS: Record<RedundancyRule, { color: string }> = {
  'health-webhook': { color: 'volcano' },
  'duplicate-error-watch': { color: 'red' },
  paused: { color: 'default' },
};

/**
 * Revue des sondes Uptime Kuma rendues inutiles par la plateforme, puis marquage par étiquette.
 * Rien n'est désactivé : Kuma reste maître de ses sondes, l'étiquette sert de pense-bête.
 */
export function KumaRedundancyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [review, setReview] = useState<RedundancyReview | null>(null);
  const t = useTranslations('health.monitors.redundancy');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagging, setTagging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setReview(null);
    apiGet<RedundancyReview>('/monitoring/kuma-redundant')
      .then((result) => {
        setReview(result);
        // Pré-sélection de ce qui n'a pas encore été marqué : la revue reste à faire à la main.
        const tagged = new Set(result.alreadyTagged);
        setSelected(result.candidates.filter((c) => !tagged.has(c.externalId)).map((c) => c.externalId));
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  const applyTag = async () => {
    setTagging(true);
    try {
      const result = await apiPost<RedundancyTagResult>('/monitoring/kuma-tag-redundant', {
        externalIds: selected,
      });
      message.success(
        result.skipped.length
          ? t('taggedWithSkipped', {
              count: result.tagged.length,
              tag: result.tagName,
              skipped: result.skipped.length,
            })
          : t('tagged', { count: result.tagged.length, tag: result.tagName }),
      );
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTagging(false);
    }
  };

  const tagged = new Set(review?.alreadyTagged ?? []);
  const savedExecutions = (review?.candidates ?? [])
    .filter((candidate) => selected.includes(candidate.externalId))
    .reduce((total, candidate) => total + (candidate.executionsPerDay ?? 0), 0);

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      onOk={applyTag}
      okText={t('ok', { count: selected.length })}
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={tagging}
      width={980}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('notice', { tag: review?.tagName ?? 'n8n-ops:à désactiver' })}
        description={savedExecutions > 0 ? t('savedExecutions', { count: savedExecutions }) : undefined}
      />
      <Table<RedundantProbe>
        rowKey="externalId"
        dataSource={review?.candidates ?? []}
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ y: 380 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as number[]),
        }}
        columns={[
          { dataIndex: 'name', title: t('probe'), ellipsis: true },
          {
            dataIndex: 'rule',
            title: t('rule'),
            width: 180,
            render: (rule: RedundancyRule) => <Tag color={RULE_LABELS[rule].color}>{t(`rules.${rule}`)}</Tag>,
          },
          {
            dataIndex: 'reason',
            title: t('reason'),
            ellipsis: true,
            render: (reason: string) => (
              <Tooltip title={reason}>
                <span>{reason}</span>
              </Tooltip>
            ),
          },
          {
            key: 'tag',
            title: t('tag'),
            width: 110,
            render: (_, probe) =>
              tagged.has(probe.externalId) ? <Tag color="blue">{t('alreadyTagged')}</Tag> : <Tag>—</Tag>,
          },
        ]}
      />
      {!loading && review?.candidates.length === 0 && (
        <p style={{ marginTop: 12, color: '#888' }}>{t('empty')}</p>
      )}
    </Modal>
  );
}
