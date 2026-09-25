'use client';

import React, { useEffect, useState } from 'react';
import { Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
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

  useEffect(() => {
    setExecutions(null);
    apiGet<ExecutionCost[]>(
      `/ai-cost/executions/${instanceId}/${encodeURIComponent(externalWorkflowId)}?days=${days}`,
    ).then(setExecutions);
  }, [instanceId, externalWorkflowId, days]);

  if (!executions) return <Spin size="small" />;
  if (executions.length === 0) {
    return <Empty description="Aucune exécution avec appel LLM" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Table<ExecutionCost>
      rowKey="executionId"
      dataSource={executions}
      size="small"
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      columns={[
        {
          title: 'Exécution',
          dataIndex: 'executionId',
          render: (id: string, row) => (
            <Typography.Text>
              #{id}{' '}
              <Typography.Text type="secondary">
                {new Date(row.startedAt).toLocaleString('fr-FR')}
              </Typography.Text>
            </Typography.Text>
          ),
        },
        {
          title: 'Modèles',
          dataIndex: 'models',
          render: (models: string[]) => models.map((model) => <Tag key={model}>{model}</Tag>),
        },
        { title: 'Appels', dataIndex: 'calls', align: 'right', width: 80 },
        {
          title: 'Tokens in / out',
          align: 'right',
          width: 140,
          render: (_, row) => `${formatTokens(row.promptTokens)} / ${formatTokens(row.completionTokens)}`,
        },
        {
          title: 'Coût',
          dataIndex: 'costUsd',
          align: 'right',
          width: 110,
          render: (cost: number, row) =>
            row.unpricedCalls > 0 ? (
              <Tooltip title={`${row.unpricedCalls} appel(s) sans tarif : coût plancher`}>
                <span>≥ {formatUsd(cost)}</span>
              </Tooltip>
            ) : (
              formatUsd(cost)
            ),
        },
      ]}
    />
  );
}
