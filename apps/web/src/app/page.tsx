'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Card, Col, Row, Skeleton, Space, Statistic, Tag, Tooltip, Typography } from 'antd';
import { Table } from '../components/resizable-table';
import { DollarOutlined, FieldTimeOutlined, RiseOutlined, WarningOutlined } from '@ant-design/icons';
import { apiGet } from '../lib/api';
import { HomeLinks } from './home-links';

interface ClientRollup {
  clientId: string | null;
  clientName: string;
  instances: number;
  executions: number;
  errors: number;
  successRate: number | null;
  timeSavedMinutes: number;
  llmCostUsd: number | null;
}

interface Overview {
  since: string;
  lastVisitAt: string | null;
  executions: { total: number; errors: number; successRate: number | null };
  problems: { opened: number; regressed: number; openTotal: number };
  drifts: Array<{ workflowName: string; ratio: number; alertedAt: string }>;
  coverage: { workflows: number; neverAnalyzed: number };
  llm: { costUsd: number | null; calls: number };
  timeSavedMinutes: number;
  timeSavedEstimatedMinutes: number;
  clients: ClientRollup[];
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
}

function formatSince(overview: Overview): string {
  const since = new Date(overview.since);
  const label = since.toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return overview.lastVisitAt && new Date(overview.lastVisitAt) < since
    ? `dernières 24 h (dernière visite : ${label})`
    : overview.lastVisitAt
      ? `depuis ta dernière visite — ${label}`
      : `dernières 24 h (première visite)`;
}

/** La vue du matin : qu'est-ce qui a changé depuis la dernière fois qu'on a regardé. */
export default function HomePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Overview>('/dashboard/overview')
      .then(setOverview)
      // Module désactivé (403) ou API muette : la home retombe sur les raccourcis.
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  if (unavailable || !overview) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Title level={2}>StepForIt Ops</Typography.Title>
        <HomeLinks />
      </div>
    );
  }

  const { problems, executions, drifts, coverage, llm } = overview;
  const quiet = problems.opened === 0 && problems.regressed === 0 && drifts.length === 0;

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        Tableau de bord
      </Typography.Title>
      <Typography.Text type="secondary">{formatSince(overview)}</Typography.Text>

      {quiet ? (
        <Alert
          type="success"
          showIcon
          style={{ margin: '16px 0' }}
          message="Rien de nouveau à signaler : pas de nouveau problème, pas de rechute, pas de dérive."
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ margin: '16px 0' }}
          message={
            <Space wrap>
              {problems.opened > 0 && (
                <Link href="/errors">
                  <Tag color="red">{problems.opened} nouveau(x) problème(s)</Tag>
                </Link>
              )}
              {problems.regressed > 0 && (
                <Link href="/errors">
                  <Tag color="volcano" icon={<WarningOutlined />}>
                    {problems.regressed} rechute(s)
                  </Tag>
                </Link>
              )}
              {drifts.length > 0 && (
                <Link href="/performance">
                  <Tag color="orange" icon={<RiseOutlined />}>
                    {drifts.length} dérive(s) de durée
                  </Tag>
                </Link>
              )}
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Statistic title="Exécutions" value={executions.total} />
          </Card>
        </Col>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Statistic
              title="Succès"
              value={executions.successRate === null ? '—' : `${(executions.successRate * 100).toFixed(1)} %`}
              valueStyle={{
                color:
                  executions.successRate !== null && executions.successRate < 0.95 ? '#cf1322' : undefined,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Link href="/errors">
              <Statistic
                title="Problèmes ouverts"
                value={problems.openTotal}
                valueStyle={{ color: problems.openTotal > 0 ? '#cf1322' : undefined }}
              />
            </Link>
          </Card>
        </Col>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Tooltip
              title={
                overview.timeSavedEstimatedMinutes > 0
                  ? `Dont ${formatHours(overview.timeSavedEstimatedMinutes)} ESTIMÉES depuis le contenu des workflows : ` +
                    "le chiffre saisi sur la page d'un workflow remplace toujours son estimation."
                  : 'Minutes saisies par workflow × exécutions réussies.'
              }
            >
              <Statistic
                title={overview.timeSavedEstimatedMinutes > 0 ? 'Temps gagné (estimé)' : 'Temps gagné'}
                value={formatHours(overview.timeSavedMinutes)}
                prefix={<FieldTimeOutlined />}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Link href="/llm-costs">
              <Statistic
                title="Coût LLM"
                value={llm.costUsd === null ? '—' : `$${llm.costUsd.toFixed(2)}`}
                prefix={<DollarOutlined />}
              />
            </Link>
          </Card>
        </Col>
        <Col xs={12} md={6} lg={4}>
          <Card size="small">
            <Link href="/findings">
              <Statistic
                title="Jamais analysés"
                value={`${coverage.neverAnalyzed}/${coverage.workflows}`}
                valueStyle={{ color: coverage.neverAnalyzed > 0 ? '#d46b08' : undefined }}
              />
            </Link>
          </Card>
        </Col>
      </Row>

      {drifts.length > 0 && (
        <Card size="small" title="Dérives de durée en cours" style={{ marginTop: 16 }}>
          <Space wrap>
            {drifts.map((drift) => (
              <Link key={drift.workflowName} href="/performance">
                <Tag color="orange" icon={<RiseOutlined />}>
                  {drift.workflowName} ×{drift.ratio.toFixed(1)}
                </Tag>
              </Link>
            ))}
          </Space>
        </Card>
      )}

      <Card size="small" title="Par client" style={{ marginTop: 16 }}>
        <Table
          dataSource={overview.clients}
          rowKey={(row) => row.clientId ?? '(none)'}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        >
          <Table.Column<ClientRollup>
            dataIndex="clientName"
            title="Client"
            render={(name: string, record) =>
              record.clientId ? name : <Typography.Text type="secondary">{name}</Typography.Text>
            }
          />
          <Table.Column dataIndex="instances" title="Instances" align="right" width={90} />
          <Table.Column dataIndex="executions" title="Exécutions" align="right" width={110} />
          <Table.Column<ClientRollup>
            dataIndex="errors"
            title="Échecs"
            align="right"
            width={90}
            render={(value: number) =>
              value > 0 ? <Typography.Text type="danger">{value}</Typography.Text> : value
            }
          />
          <Table.Column<ClientRollup>
            dataIndex="successRate"
            title="Succès"
            width={100}
            render={(rate: number | null) =>
              rate === null ? (
                '—'
              ) : (
                <Tag color={rate < 0.95 ? 'orange' : 'green'}>{(rate * 100).toFixed(1)} %</Tag>
              )
            }
          />
          <Table.Column<ClientRollup>
            dataIndex="timeSavedMinutes"
            title="Temps gagné"
            align="right"
            width={110}
            render={(minutes: number) => formatHours(minutes)}
          />
          <Table.Column<ClientRollup>
            dataIndex="llmCostUsd"
            title="Coût LLM"
            align="right"
            width={100}
            render={(cost: number | null) => (cost === null ? '—' : `$${cost.toFixed(2)}`)}
          />
        </Table>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Le temps gagné se règle workflow par workflow (page du workflow, « min gagnées / exécution ») ; les
          clients se gèrent dans Paramètres → Clients.
        </Typography.Text>
      </Card>

      <div style={{ marginTop: 24 }}>
        <HomeLinks />
      </div>
    </div>
  );
}
