'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Tag, Tooltip, message } from 'antd';
import { Table } from '../../components/resizable-table';
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

const RULE_LABELS: Record<RedundancyRule, { label: string; color: string }> = {
  'health-webhook': { label: 'health webhook', color: 'volcano' },
  'duplicate-error-watch': { label: 'doublon error-watch', color: 'red' },
  paused: { label: 'en pause', color: 'default' },
};

/**
 * Revue des sondes Uptime Kuma rendues inutiles par la plateforme, puis marquage par étiquette.
 * Rien n'est désactivé : Kuma reste maître de ses sondes, l'étiquette sert de pense-bête.
 */
export function KumaRedundancyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [review, setReview] = useState<RedundancyReview | null>(null);
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
        `${result.tagged.length} sonde(s) marquée(s) « ${result.tagName} » dans Uptime Kuma` +
          (result.skipped.length ? `, ${result.skipped.length} ignorée(s)` : ''),
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
      title="Sondes Kuma devenues redondantes"
      open={open}
      onCancel={onClose}
      onOk={applyTag}
      okText={`Marquer dans Kuma (${selected.length})`}
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={tagging}
      width={980}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={`Aucune sonde n'est désactivée : elles reçoivent l'étiquette « ${
          review?.tagName ?? 'n8n-ops:à désactiver'
        } », à toi de les couper dans Uptime Kuma.`}
        description={
          savedExecutions > 0
            ? `Les sondes sélectionnées déclenchent environ ${savedExecutions} exécutions n8n par jour, que l'error-watch rend inutiles.`
            : undefined
        }
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
          { dataIndex: 'name', title: 'Sonde Kuma', ellipsis: true },
          {
            dataIndex: 'rule',
            title: 'Motif',
            width: 180,
            render: (rule: RedundancyRule) => (
              <Tag color={RULE_LABELS[rule].color}>{RULE_LABELS[rule].label}</Tag>
            ),
          },
          {
            dataIndex: 'reason',
            title: 'Pourquoi',
            ellipsis: true,
            render: (reason: string) => (
              <Tooltip title={reason}>
                <span>{reason}</span>
              </Tooltip>
            ),
          },
          {
            title: 'Étiquette',
            width: 110,
            render: (_, probe) =>
              tagged.has(probe.externalId) ? <Tag color="blue">déjà posée</Tag> : <Tag>—</Tag>,
          },
        ]}
      />
      {!loading && review?.candidates.length === 0 && (
        <p style={{ marginTop: 12, color: '#888' }}>
          Aucune sonde redondante : rien à désactiver dans Uptime Kuma.
        </p>
      )}
    </Modal>
  );
}
