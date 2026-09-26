'use client';

import React, { useEffect, useState } from 'react';
import { Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet } from '../../lib/api';
import { ExecutionCost, formatTokens, formatUsd } from './types';

/** Drill-down d'un workflow : le coût de chacune de ses exécutions récentes. */
export function WorkflowExecutions({
  instanceId,
  externalWorkflowId,
  days,
}: {
  instanceId: string;
  externalWorkflowId: string;
  days: number;
}) {
  const [executions, setExecutions] = useState<ExecutionCost[] | null>(null);
  const t = useTranslations('health.llmCosts');
  const locale = useLocale();

  useEffect(() => {
    setExecutions(null);
    apiGet<ExecutionCost[]>(
      `/ai-cost/executions/${instanceId}/${encodeURIComponent(externalWorkflowId)}?days=${days}`,
    ).then(setExecutions);
  }, [instanceId, externalWorkflowId, days]);

  if (!executions) return <Spin size="small" />;
  if (executions.length === 0) {
    return <Empty description={t('executions.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Table<ExecutionCost>
      rowKey="executionId"
      dataSource={executions}
      size="small"
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      columns={[
        {
          title: t('executions.execution'),
          dataIndex: 'executionId',
          render: (id: string, row) => (
            <Typography.Text>
              #{id}{' '}
              <Typography.Text type="secondary">
                {new Date(row.startedAt).toLocaleString(locale)}
              </Typography.Text>
            </Typography.Text>
          ),
        },
        {
          title: t('executions.models'),
          dataIndex: 'models',
          render: (models: string[]) => models.map((model) => <Tag key={model}>{model}</Tag>),
        },
        { title: t('columns.calls'), dataIndex: 'calls', align: 'right', width: 80 },
        {
          key: 'tokens',
          title: t('columns.tokens'),
          align: 'right',
          width: 140,
          render: (_, row) =>
            `${formatTokens(row.promptTokens, locale)} / ${formatTokens(row.completionTokens, locale)}`,
        },
        {
          title: t('columns.cost'),
          dataIndex: 'costUsd',
          align: 'right',
          width: 110,
          render: (cost: number, row) =>
            row.unpricedCalls > 0 ? (
              <Tooltip title={t('unpricedFloor', { count: row.unpricedCalls })}>
                <span>≥ {formatUsd(cost, locale)}</span>
              </Tooltip>
            ) : (
              formatUsd(cost, locale)
            ),
        },
      ]}
    />
  );
}
