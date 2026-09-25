'use client';

import React from 'react';
import { Progress, Space, Tag, Tooltip, Typography } from 'antd';
import { Table } from '../../components/resizable-table';
import { useEnvColor } from '../../lib/envs';
import { WorkflowExecutions } from './workflow-executions';
import { WorkflowCost, WorkflowCostFamily, formatTokens, formatUsd } from './types';

/** Coût, avec la mention « plancher » dès qu'un appel n'a pas de tarif. */
function cost(value: number, unpricedCalls: number): React.ReactNode {
  if (unpricedCalls === 0) return formatUsd(value);
  return (
    <Tooltip title={`${unpricedCalls} appel(s) sans tarif : coût plancher`}>
      <span>≥ {formatUsd(value)}</span>
    </Tooltip>
  );
}

/**
 * Le classement des coûts, à deux lectures. Groupé, une ligne par workflow
 * MÉTIER : deux exemplaires d'un même workflow tombaient chacun de leur côté du
 * classement et paraissaient tous les deux modestes, alors que c'est la même
 * facture. Déplié, on voit ce que la mise au point coûte à côté de la prod —
 * les totaux de la page, eux, ne bougent pas : un appel LLM en dev est une
 * dépense réelle.
 */
export function WorkflowCostTable({
  workflows,
  families,
  grouped,
  days,
  loading,
  totalCost,
}: {
  workflows: WorkflowCost[];
  families: WorkflowCostFamily[];
  grouped: boolean;
  days: number;
  loading: boolean;
  totalCost: number;
}) {
  const envColor = useEnvColor();
  /** Niveau 2 : un exemplaire par env, ses exécutions repliées dessous. */
  const members = (family: WorkflowCostFamily) => (
    <Table<WorkflowCost>
      rowKey={(row) => `${row.instanceId}|${row.externalWorkflowId}`}
      dataSource={family.members}
      pagination={false}
      size="small"
      expandable={{
        expandedRowRender: (row) => (
          <WorkflowExecutions
            instanceId={row.instanceId}
            externalWorkflowId={row.externalWorkflowId}
            days={days}
          />
        ),
      }}
      columns={[
        {
          title: 'Env',
          dataIndex: 'env',
          width: 90,
          render: (env: WorkflowCost['env']) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>),
        },
        { title: 'Workflow', dataIndex: 'name', ellipsis: true },
        { title: 'Exécutions', dataIndex: 'executions', align: 'right', width: 100 },
        { title: 'Appels', dataIndex: 'calls', align: 'right', width: 80 },
        {
          title: 'Tokens in / out',
          align: 'right',
          width: 150,
          render: (_, row) => `${formatTokens(row.promptTokens)} / ${formatTokens(row.completionTokens)}`,
        },
        {
          title: 'Coût',
          dataIndex: 'costUsd',
          align: 'right',
          width: 110,
          render: (_: number, row) => cost(row.costUsd, row.unpricedCalls),
        },
        {
          title: '% de la famille',
          width: 140,
          render: (_, row) => (
            <Progress
              percent={family.costUsd > 0 ? Math.round((row.costUsd / family.costUsd) * 100) : 0}
              size="small"
            />
          ),
        },
      ]}
    />
  );

  if (grouped) {
    return (
      <Table<WorkflowCostFamily>
        rowKey="id"
        dataSource={families}
        loading={loading}
        size="small"
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: true }}
        expandable={{ expandedRowRender: members }}
        columns={[
          {
            title: 'Workflow',
            dataIndex: 'name',
            ellipsis: true,
            render: (name: string, row) => (
              <Space size={4}>
                <Typography.Text strong>{name}</Typography.Text>
                {row.envs.map((env) => (
                  <Tag key={env} color={envColor(env)}>
                    {env}
                  </Tag>
                ))}
                {row.unknownEnvCount > 0 && <Tag>{row.unknownEnvCount} · ?</Tag>}
              </Space>
            ),
          },
          { title: 'Exécutions', dataIndex: 'executions', align: 'right', width: 100 },
          { title: 'Appels', dataIndex: 'calls', align: 'right', width: 80 },
          {
            title: 'Tokens in / out',
            align: 'right',
            width: 150,
            render: (_, row) => `${formatTokens(row.promptTokens)} / ${formatTokens(row.completionTokens)}`,
          },
          {
            title: 'Coût',
            dataIndex: 'costUsd',
            align: 'right',
            width: 110,
            sorter: (a, b) => a.costUsd - b.costUsd,
            render: (_: number, row) => cost(row.costUsd, row.unpricedCalls),
          },
          {
            title: '% du total',
            width: 140,
            render: (_, row) => (
              <Progress
                percent={totalCost > 0 ? Math.round((row.costUsd / totalCost) * 100) : 0}
                size="small"
              />
            ),
          },
        ]}
      />
    );
  }

  return (
    <Table<WorkflowCost>
      rowKey={(row) => `${row.instanceId}|${row.externalWorkflowId}`}
      dataSource={workflows}
      loading={loading}
      size="small"
      pagination={{ pageSize: 15, hideOnSinglePage: true }}
      scroll={{ x: true }}
      expandable={{
        expandedRowRender: (row) => (
          <WorkflowExecutions
            instanceId={row.instanceId}
            externalWorkflowId={row.externalWorkflowId}
            days={days}
          />
        ),
      }}
      columns={[
        { title: 'Workflow', dataIndex: 'name', ellipsis: true },
        {
          title: 'Env',
          dataIndex: 'env',
          width: 90,
          render: (env: WorkflowCost['env']) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>),
        },
        { title: 'Exécutions', dataIndex: 'executions', align: 'right', width: 100 },
        { title: 'Appels', dataIndex: 'calls', align: 'right', width: 80 },
        {
          title: 'Tokens in / out',
          align: 'right',
          width: 150,
          render: (_, row) => `${formatTokens(row.promptTokens)} / ${formatTokens(row.completionTokens)}`,
        },
        {
          title: 'Coût',
          dataIndex: 'costUsd',
          align: 'right',
          width: 110,
          sorter: (a, b) => a.costUsd - b.costUsd,
          render: (_: number, row) => cost(row.costUsd, row.unpricedCalls),
        },
        {
          title: '% du total',
          width: 140,
          render: (_, row) => (
            <Progress
              percent={totalCost > 0 ? Math.round((row.costUsd / totalCost) * 100) : 0}
              size="small"
            />
          ),
        },
      ]}
    />
  );
}
