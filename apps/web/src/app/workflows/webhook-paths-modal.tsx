'use client';

import React from 'react';
import { Alert, Button, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { apiGet, apiPost } from '../../lib/api';

interface PathFix {
  workflowId: string;
  workflowName: string;
  env: string;
  node: string;
  from: string;
  to: string;
  keeper: string;
}

interface PathStandoff {
  path: string;
  workflows: string[];
  reason: string;
}

interface Instance {
  id: string;
  name: string;
}

/**
 * Rattrapage des copies d'env d'avant : elles ont hérité du path de leur original,
 * que n8n n'attribue qu'à un seul workflow. Le gardien de l'URL n'est jamais touché.
 */
export function WebhookPathsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [instances, setInstances] = React.useState<Instance[]>([]);
  const [instanceId, setInstanceId] = React.useState<string | null>(null);
  const [fixes, setFixes] = React.useState<PathFix[] | null>(null);
  const [standoffs, setStandoffs] = React.useState<PathStandoff[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFixes(null);
    setError(null);
    apiGet<Instance[]>('/instances')
      .then((list) => {
        setInstances(list);
        if (list.length === 1) setInstanceId(list[0].id);
      })
      .catch((e) => setError((e as Error).message));
  }, [open]);

  const analyse = async (id: string) => {
    setLoading(true);
    setError(null);
    setFixes(null);
    try {
      const report = await apiGet<{ fixes: PathFix[]; standoffs: PathStandoff[] }>(
        `/env-switcher/webhook-paths/${id}`,
      );
      setFixes(report.fixes);
      setStandoffs(report.standoffs);
      setSelected(report.fixes.map((fix) => fix.workflowId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!instanceId) return;
    setApplying(true);
    try {
      const result = await apiPost<{
        results: Array<{ workflowName: string; applied: boolean; error?: string }>;
      }>(`/env-switcher/webhook-paths/${instanceId}`, { workflowIds: selected });
      const done = result.results.filter((r) => r.applied);
      message.success(`${done.length} path(s) corrigé(s)`);
      for (const failed of result.results.filter((r) => !r.applied)) {
        message.error(`« ${failed.workflowName} » : ${failed.error}`, 8);
      }
      await analyse(instanceId);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title="Points d’entrée partagés"
      open={open}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="close" onClick={onClose}>
          Fermer
        </Button>,
        <Button
          key="apply"
          type="primary"
          loading={applying}
          disabled={selected.length === 0}
          onClick={apply}
        >
          Corriger {selected.length} path(s)
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          Une copie qui partage le path de son original ne reçoit rien. La prod garde son URL.
        </Typography.Text>

        <Space>
          <Select
            style={{ width: 360 }}
            placeholder="Choisir une instance"
            value={instanceId}
            onChange={(value: string) => {
              setInstanceId(value);
              setFixes(null);
            }}
            options={instances.map((instance) => ({ value: instance.id, label: instance.name }))}
          />
          <Button
            type="primary"
            disabled={!instanceId}
            loading={loading}
            onClick={() => analyse(instanceId!)}
          >
            Analyser
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message="Analyse impossible" description={error} />}

        {fixes && fixes.length === 0 && standoffs.length === 0 && (
          <Typography.Text type="secondary">Aucun path partagé sur cette instance.</Typography.Text>
        )}

        {fixes && fixes.length > 0 && (
          <Table
            size="small"
            rowKey="workflowId"
            dataSource={fixes}
            pagination={false}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            columns={[
              {
                title: 'Copie',
                dataIndex: 'workflowName',
                render: (name: string, row: PathFix) => (
                  <>
                    {name} <Tag>{row.env}</Tag>
                  </>
                ),
              },
              { title: 'Nœud', dataIndex: 'node' },
              {
                title: 'Path',
                render: (_: unknown, row: PathFix) => (
                  <Typography.Text>
                    <Typography.Text delete type="secondary">
                      /{row.from}
                    </Typography.Text>{' '}
                    → <Typography.Text strong>/{row.to}</Typography.Text>
                  </Typography.Text>
                ),
              },
              {
                title: 'Garde l’URL',
                dataIndex: 'keeper',
                render: (keeper: string) => <Typography.Text type="secondary">{keeper}</Typography.Text>,
              },
            ]}
          />
        )}

        {standoffs.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`${standoffs.length} conflit(s) à régler à la main`}
            description={
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {standoffs.map((standoff, index) => (
                  <li key={`${standoff.path}-${index}`}>
                    <code>/{standoff.path}</code> — {standoff.workflows.join(', ')} : {standoff.reason}
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </Space>
    </Modal>
  );
}
