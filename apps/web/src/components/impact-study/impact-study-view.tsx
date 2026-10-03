'use client';

import React from 'react';
import Link from 'next/link';
import { Collapse, Empty, Space, Statistic, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { BRAND } from '../../lib/brand/colors';
import { useEnvColor, useEnvLabel } from '../../lib/envs';
import { ImpactLevel, ImpactSummary, LEVEL_ORDER, WorkflowImpact, WorkflowRef } from './types';

/** Le niveau se lit à la couleur avant le mot : rouge, orange, ambre, vert. */
const LEVEL_COLOR: Record<ImpactLevel, string> = {
  critical: 'red',
  high: 'volcano',
  medium: 'gold',
  low: 'green',
};

export function ImpactLevelTag({ level }: { level: ImpactLevel }) {
  const t = useTranslations('misc.impactStudy');
  return <Tag color={LEVEL_COLOR[level]}>{t(`level.${level}`)}</Tag>;
}

/** Le lot vu d'en haut : la réponse d'abord (le niveau le plus haut), les chiffres qui la justifient ensuite. */
export function ImpactSummaryBar({ summary, windowDays }: { summary: ImpactSummary; windowDays: number }) {
  const t = useTranslations('misc.impactStudy');
  return (
    <div
      style={{
        border: `1px solid ${BRAND.hairline}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        background: BRAND.papier,
      }}
    >
      <Space wrap size="large" align="center">
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {t('summary.highest')}
          </Typography.Text>
          <ImpactLevelTag level={summary.highest} />
        </div>
        <Statistic title={t('summary.workflows')} value={summary.count} />
        <Statistic title={t('summary.executions', { days: windowDays })} value={summary.executions30d} />
        <Statistic title={t('summary.externalCallers')} value={summary.externalCallers} />
        <Statistic title={t('summary.resources')} value={summary.resources} />
      </Space>
      {summary.count > 1 && (
        <Space wrap size={4} style={{ marginTop: 12 }}>
          {LEVEL_ORDER.filter((level) => summary.byLevel[level] > 0).map((level) => (
            <Tag key={level} color={LEVEL_COLOR[level]}>
              {t('summary.byLevel', { count: summary.byLevel[level], level: t(`level.${level}`) })}
            </Tag>
          ))}
        </Space>
      )}
    </div>
  );
}

function WorkflowLinks({ refs }: { refs: WorkflowRef[] }) {
  const envLabel = useEnvLabel();
  return (
    <Space wrap size={4}>
      {refs.map((ref) => (
        <Link key={ref.id} href={`/workflows/show/${ref.id}`}>
          <Tag style={{ cursor: 'pointer' }}>
            {ref.name}
            {ref.env ? ` · ${envLabel(ref.env)}` : ''}
          </Tag>
        </Link>
      ))}
    </Space>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {title}
      </Typography.Text>
      {children}
    </div>
  );
}

/** Le détail d'un exemplaire : pourquoi ce niveau, ce qui rassure, puis qui et quoi est touché. */
export function ImpactDetail({ impact }: { impact: WorkflowImpact }) {
  const t = useTranslations('misc.impactStudy');
  return (
    <div>
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        {impact.reasons.map((reason) => (
          <Typography.Text key={reason}>
            <WarningOutlined style={{ color: BRAND.warning, marginRight: 6 }} />
            {reason}
          </Typography.Text>
        ))}
        {impact.safeguards.map((safeguard) => (
          <Typography.Text key={safeguard}>
            <CheckCircleOutlined style={{ color: BRAND.success, marginRight: 6 }} />
            {safeguard}
          </Typography.Text>
        ))}
      </Space>
      {impact.callers.length > 0 && (
        <Section title={t('detail.callers', { count: impact.callers.length })}>
          <WorkflowLinks refs={impact.callers} />
        </Section>
      )}
      {impact.callees.length > 0 && (
        <Section title={t('detail.callees', { count: impact.callees.length })}>
          <WorkflowLinks refs={impact.callees} />
        </Section>
      )}
      {impact.entryPoints.length > 0 && (
        <Section title={t('detail.entryPoints')}>
          <Space wrap size={4}>
            {impact.entryPoints.map((entry) => (
              <Tag key={`${entry.kind}:${entry.label}`}>{entry.label}</Tag>
            ))}
          </Space>
        </Section>
      )}
      {impact.resources.length > 0 && (
        <Section title={t('detail.resources', { count: impact.resources.length })}>
          <Space wrap size={4}>
            {impact.resources.map((resource) => (
              <Tooltip key={resource.key} title={resource.mapped ? resource.key : t('detail.unmapped')}>
                <Tag color={resource.mapped ? undefined : 'orange'}>{resource.label}</Tag>
              </Tooltip>
            ))}
          </Space>
        </Section>
      )}
      <Section title={t('detail.activity')}>
        <Typography.Text>
          {impact.lastExecutionAt
            ? t('detail.lastExecution', {
                date: new Date(impact.lastExecutionAt).toLocaleString(),
                failures: impact.facts.failures30d,
              })
            : t('detail.noExecution')}
        </Typography.Text>
      </Section>
      {impact.partial && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          <ExclamationCircleOutlined style={{ marginRight: 6 }} />
          {t('detail.partial')}
        </Typography.Paragraph>
      )}
    </div>
  );
}

/** En-tête repliable : niveau, nom, env, et le chiffre qui pèse le plus. */
export function ImpactHeader({ impact, extra }: { impact: WorkflowImpact; extra?: React.ReactNode }) {
  const t = useTranslations('misc.impactStudy');
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  const { workflow, facts } = impact;
  return (
    <Space wrap size={6} style={{ width: '100%' }}>
      <ImpactLevelTag level={impact.level} />
      <Typography.Text strong>{workflow.name}</Typography.Text>
      {workflow.env && <Tag color={envColor(workflow.env)}>{envLabel(workflow.env)}</Tag>}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('header', { executions: facts.executions30d, callers: facts.callers })}
      </Typography.Text>
      {extra}
      {workflow.url && (
        <a href={workflow.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <ExportOutlined />
        </a>
      )}
    </Space>
  );
}

/** Plus engageant d'abord : c'est par là qu'on commence à relire. */
export function sortByLevel<T extends { impact: WorkflowImpact | null }>(rows: T[]): T[] {
  const rank = (row: T) => (row.impact ? LEVEL_ORDER.indexOf(row.impact.level) : LEVEL_ORDER.length);
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

export function ImpactList({ items }: { items: WorkflowImpact[] }) {
  const t = useTranslations('misc.impactStudy');
  if (items.length === 0) return <Empty description={t('empty')} />;
  const sorted = sortByLevel(items.map((impact) => ({ impact }))).map((row) => row.impact);
  return (
    <Collapse
      defaultActiveKey={sorted.length === 1 ? [sorted[0].workflow.id] : []}
      items={sorted.map((impact) => ({
        key: impact.workflow.id,
        label: <ImpactHeader impact={impact} />,
        children: <ImpactDetail impact={impact} />,
      }))}
    />
  );
}
