'use client';

import React from 'react';
import { Empty, Space, Tooltip, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { DailyCost, formatTokens, formatUsd } from './types';
import { BRAND } from '../../lib/brand/colors';

const WIDTH = 680;
const HEIGHT = 170;
/** Marges du cadre : à gauche les dollars, en bas les dates. */
const MARGIN = { top: 8, right: 8, bottom: 22, left: 64 };
const GAP = 2;
const MAX_BAR_WIDTH = 28;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** "2026-08-20" → "20/08" (fr) ou "08/20" (en) */
function dayLabel(date: string, locale: string): string {
  return locale.startsWith('fr')
    ? `${date.slice(8, 10)}/${date.slice(5, 7)}`
    : `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

/**
 * Coût quotidien : une barre par jour, hauteur = dollars valorisés. SVG maison
 * comme le graphe de tendance perf — cette taille n'a pas besoin d'une lib.
 */
export function CostDailyChart({ daily }: { daily: DailyCost[] }) {
  const t = useTranslations('health.llmCosts.chart');
  const locale = useLocale();
  if (daily.length === 0) {
    return <Empty description={t('empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const max = Math.max(...daily.map((d) => d.costUsd), 0.000001);
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(4, PLOT_WIDTH / daily.length - GAP));
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8));
  const yTicks = [0, 0.5, 1];

  return (
    <Space direction="vertical" size={4} style={{ width: '100%', maxWidth: WIDTH }}>
      <Typography.Text type="secondary">
        {t('title')}
        {daily.length < 3 && ` · ${t('shortHistory', { count: daily.length })}`}
      </Typography.Text>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', maxWidth: WIDTH, height: 'auto', display: 'block' }}
        role="img"
        aria-label={t('ariaLabel')}
      >
        {yTicks.map((tick) => {
          const y = MARGIN.top + PLOT_HEIGHT - tick * PLOT_HEIGHT;
          return (
            <g key={tick}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} stroke={BRAND.craie} />
              <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#888">
                {formatUsd(max * tick, locale)}
              </text>
            </g>
          );
        })}
        {daily.map((day, index) => {
          const height = max > 0 ? (day.costUsd / max) * PLOT_HEIGHT : 0;
          const x = MARGIN.left + index * (PLOT_WIDTH / daily.length) + GAP / 2;
          const y = MARGIN.top + PLOT_HEIGHT - height;
          return (
            <g key={day.date}>
              <Tooltip
                title={t('barTitle', {
                  day: dayLabel(day.date, locale),
                  cost: formatUsd(day.costUsd, locale),
                  calls: day.calls,
                  tokensIn: formatTokens(day.promptTokens, locale),
                  tokensOut: formatTokens(day.completionTokens, locale),
                })}
              >
                <rect x={x} y={y} width={barWidth} height={Math.max(height, 1)} fill={BRAND.primary} rx={2} />
              </Tooltip>
              {index % labelEvery === 0 && (
                <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="#888">
                  {dayLabel(day.date, locale)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Space>
  );
}
