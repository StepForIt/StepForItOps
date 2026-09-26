'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { apiDelete, apiGet } from '../../lib/api';
import { useRuleLabel } from '../../lib/finding-rules';
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
  const t = useTranslations('inventory.findingIgnores');
  const locale = useLocale();
  const ruleLabel = useRuleLabel();
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
      message.success(t('removed'));
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
    <Card title={t('title')} extra={<Button onClick={load}>{t('refresh')}</Button>}>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder={t('module')}
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
          emptyText: <Empty description={t('empty')} />,
        }}
      >
        <Table.Column<IgnoreRule>
          dataIndex="module"
          title={t('columns.module')}
          render={(m: string) => <Tag>{m}</Tag>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="code"
          title={t('columns.rule')}
          render={(code: string) => <Tooltip title={code}>{ruleLabel(code)}</Tooltip>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="message"
          title={t('columns.message')}
          ellipsis
          render={(msg: string | null) => msg ?? <span style={{ color: '#999' }}>—</span>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="workflowId"
          title={t('columns.scope')}
          render={(_, record) => {
            if (record.workflowId) return record.workflow?.name ?? record.workflowId;
            if (record.familyKey) {
              return (
                <Tooltip title={t('familyHint')}>
                  <Tag color="blue">{t('family', { family: record.familyKey })}</Tag>
                </Tooltip>
              );
            }
            return <Tag color="volcano">{t('global')}</Tag>;
          }}
        />
        <Table.Column<IgnoreRule>
          dataIndex="nodeName"
          title={t('columns.node')}
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
          title={t('columns.reason')}
          render={(reason: string | null) => reason ?? <span style={{ color: '#999' }}>—</span>}
        />
        <Table.Column<IgnoreRule>
          dataIndex="createdAt"
          title={t('columns.since')}
          render={(d: string) => new Date(d).toLocaleString(locale)}
        />
        <Table.Column<IgnoreRule>
          title=""
          render={(_, record) => (
            <Popconfirm
              title={t('confirmTitle')}
              description={t('confirmDescription')}
              okText={t('reactivate')}
              cancelText={t('cancel')}
              onConfirm={() => remove(record.id)}
            >
              <Button size="small">{t('stopIgnoring')}</Button>
            </Popconfirm>
          )}
        />
      </Table>
    </Card>
  );
}
