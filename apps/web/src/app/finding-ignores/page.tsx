'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { apiDelete, apiGet } from '../../lib/api';
import { ruleLabel } from '../../lib/finding-rules';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';

interface IgnoreRule {
  id: string;
  workflowId: string | null;
  workflow?: { name: string } | null;
  /** Portée « tous les environnements » : nom métier du workflow (cf. workflow-family). */
  familyKey: string | null;
  module: string;
  code: string;
  nodeName: string | null;
  /** Message du finding d'origine : pour une règle IA, le code seul ne dit rien. */
  message: string | null;
  reason: string | null;
  createdAt: string;
}

/** Règles « ce finding est normal » : consultation et réactivation. */
export default function FindingIgnores() {
  const { scope } = useInstanceScope();
  const [rows, setRows] = useState<IgnoreRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = usePersistedState<string | undefined>('module', undefined);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<IgnoreRule[]>(`/finding-ignores?_start=0&_end=500${scope ? `&instanceId=${scope}` : ''}`)
      .then(setRows)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(load, [load]);

  const remove = async (id: string) => {
    try {
      await apiDelete(`/finding-ignores/${id}`);
      message.success('Règle supprimée — relance une analyse pour revoir le finding');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const moduleOptions = Array.from(new Set(rows.map((r) => r.module)))
    .sort()
    .map((m) => ({ value: m, label: m }));
  const filtered = moduleFilter ? rows.filter((r) => r.module === moduleFilter) : rows;

  return (
    <Card title="Findings ignorés" extra={<Button onClick={load}>Rafraîchir</Button>}>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Module"
          style={{ minWidth: 200 }}
          value={moduleFilter}
          onChange={setModuleFilter}
          options={moduleOptions}
        />
      </Space>
      <Table
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        locale={{
          emptyText: <Empty description="Aucune règle" />,
        }}
      >
        <Table.Column<IgnoreRule> dataIndex="module" title="Module" render={(m: string) => <Tag>{m}</Tag>} />
        <Table.Column<IgnoreRule>
          dataIndex="code"
          title="Règle"
          render={(code: string) => <Tooltip title={code}>{ruleLabel(code)}</Tooltip>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="message"
          title="Remarque"
          ellipsis
          render={(msg: string | null) => msg ?? <span style={{ color: '#999' }}>—</span>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="workflowId"
          title="Portée"
          render={(_, record) => {
            if (record.workflowId) return record.workflow?.name ?? record.workflowId;
            if (record.familyKey) {
              return (
                <Tooltip title="Le même workflow métier dans tous ses environnements déclarés">
                  <Tag color="blue">{record.familyKey} — tous env.</Tag>
                </Tooltip>
              );
            }
            return <Tag color="volcano">tous les workflows</Tag>;
          }}
        />
        <Table.Column<IgnoreRule>
          dataIndex="nodeName"
          title="Nœud"
          render={(nodeName: string | null) =>
            nodeName ? (
              <Tag color="purple">{nodeName}</Tag>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )
          }
        />
        <Table.Column<IgnoreRule>
          dataIndex="reason"
          title="Raison"
          render={(reason: string | null) => reason ?? <span style={{ color: '#999' }}>—</span>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="createdAt"
          title="Depuis"
          render={(d: string) => new Date(d).toLocaleString('fr-FR')}
        />
        <Table.Column<IgnoreRule>
          title=""
          render={(_, record) => (
            <Popconfirm
              title="Ne plus ignorer ?"
              description="Le finding réapparaîtra à la prochaine analyse du workflow."
              okText="Réactiver"
              cancelText="Annuler"
              onConfirm={() => remove(record.id)}
            >
              <Button size="small">Ne plus ignorer</Button>
            </Popconfirm>
          )}
        />
      </Table>
    </Card>
  );
}
