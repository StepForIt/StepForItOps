'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Card, Skeleton, Space, Tag, Typography } from 'antd';
import { Table } from '../components/resizable-table';
import { RiseOutlined } from '@ant-design/icons';
import { apiGet } from '../lib/api';
import { HomeLinks } from './home-links';
import { DashboardHero, type HeroFigure, type HeroSignal } from './dashboard/dashboard-hero';
import { KpiTile } from './dashboard/kpi-tile';
import './dashboard/dashboard.css';

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

type HomeT = ReturnType<typeof useTranslations<'misc.home'>>;

function formatHours(minutes: number, t: HomeT, locale: string): string {
  if (minutes < 60) return t('minutes', { value: Math.round(minutes) });
  return t('hours', { value: (minutes / 60).toLocaleString(locale, { maximumFractionDigits: 1 }) });
}

function formatPercent(rate: number, t: HomeT): string {
  return t('percent', { value: (rate * 100).toFixed(1) });
}

function formatSince(overview: Overview, t: HomeT, locale: string): string {
  const since = new Date(overview.since);
  const date = since.toLocaleString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return overview.lastVisitAt && new Date(overview.lastVisitAt) < since
    ? t('since.expired', { date })
    : overview.lastVisitAt
      ? t('since.lastVisit', { date })
      : t('since.firstVisit');
}

/** La vue du matin : qu'est-ce qui a changé depuis la dernière fois qu'on a regardé. */
export default function HomePage() {
  const t = useTranslations('misc.home');
  const locale = useLocale();
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
  const signals: HeroSignal[] = [
    ...(problems.opened > 0
      ? [
          {
            href: '/errors',
            label: t('opened', { count: problems.opened }),
            tone: 'corail' as const,
          },
        ]
      : []),
    ...(problems.regressed > 0
      ? [
          {
            href: '/errors',
            label: t('regressed', { count: problems.regressed }),
            tone: 'corail' as const,
          },
        ]
      : []),
    ...(drifts.length > 0
      ? [
          {
            href: '/performance',
            label: t('drifts', { count: drifts.length }),
            tone: 'ambre' as const,
          },
        ]
      : []),
  ];
  const successRate = executions.successRate === null ? '—' : formatPercent(executions.successRate, t);
  const figures: HeroFigure[] = [
    {
      value: formatHours(overview.timeSavedMinutes, t, locale),
      label:
        overview.timeSavedEstimatedMinutes > 0 ? t('figures.timeSavedEstimated') : t('figures.timeSaved'),
      tone: 'roi',
    },
    {
      value: llm.costUsd === null ? '—' : `$${llm.costUsd.toFixed(2)}`,
      label: t('figures.aiCost'),
      tone: 'craie',
      href: '/llm-costs',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3} style={{ marginBottom: 16 }}>
        {t('title')}
      </Typography.Title>

      <DashboardHero since={formatSince(overview, t, locale)} signals={signals} figures={figures} />

      <div className="dash-kpis">
        <KpiTile
          label={t('stats.executions')}
          value={executions.total.toLocaleString(locale)}
          tone="marine"
        />
        <KpiTile
          label={t('stats.success')}
          value={successRate}
          tone={executions.successRate !== null && executions.successRate < 0.95 ? 'corail' : 'roi'}
        />
        <KpiTile
          label={t('stats.openProblems')}
          value={problems.openTotal}
          tone={problems.openTotal > 0 ? 'corail' : 'roi'}
          href="/errors"
        />
        <KpiTile
          label={t('stats.neverAnalyzed')}
          value={`${coverage.neverAnalyzed}/${coverage.workflows}`}
          tone={coverage.neverAnalyzed > 0 ? 'ambre' : 'roi'}
          href="/findings"
        />
        <KpiTile
          label={t('stats.timeSaved')}
          value={formatHours(overview.timeSavedMinutes, t, locale)}
          tone="lagon"
          hint={
            overview.timeSavedEstimatedMinutes > 0
              ? t('estimatedHint', { value: formatHours(overview.timeSavedEstimatedMinutes, t, locale) })
              : undefined
          }
        />
      </div>

      {drifts.length > 0 && (
        <Card size="small" title={t('activeDrifts')} style={{ marginBottom: 16 }}>
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

      <Card size="small" title={t('byClient')}>
        <Table
          dataSource={overview.clients}
          rowKey={(row) => row.clientId ?? '(none)'}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        >
          <Table.Column<ClientRollup>
            dataIndex="clientName"
            title={t('columns.client')}
            render={(name: string, record) =>
              record.clientId ? name : <Typography.Text type="secondary">{name}</Typography.Text>
            }
          />
          <Table.Column dataIndex="instances" title={t('columns.instances')} align="right" width={90} />
          <Table.Column dataIndex="executions" title={t('stats.executions')} align="right" width={110} />
          <Table.Column<ClientRollup>
            dataIndex="errors"
            title={t('columns.failures')}
            align="right"
            width={90}
            render={(value: number) =>
              value > 0 ? <Typography.Text type="danger">{value}</Typography.Text> : value
            }
          />
          <Table.Column<ClientRollup>
            dataIndex="successRate"
            title={t('stats.success')}
            width={100}
            render={(rate: number | null) =>
              rate === null ? (
                '—'
              ) : (
                <Tag color={rate < 0.95 ? 'orange' : 'green'}>{formatPercent(rate, t)}</Tag>
              )
            }
          />
          <Table.Column<ClientRollup>
            dataIndex="timeSavedMinutes"
            title={t('stats.timeSaved')}
            align="right"
            width={110}
            render={(minutes: number) => formatHours(minutes, t, locale)}
          />
          <Table.Column<ClientRollup>
            dataIndex="llmCostUsd"
            title={t('stats.llmCost')}
            align="right"
            width={100}
            render={(cost: number | null) => (cost === null ? '—' : `$${cost.toFixed(2)}`)}
          />
        </Table>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('footnote')}
        </Typography.Text>
      </Card>

      <div style={{ marginTop: 24 }}>
        <HomeLinks />
      </div>
    </div>
  );
}
