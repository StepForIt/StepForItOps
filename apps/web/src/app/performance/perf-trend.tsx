'use client';

import React, { useEffect, useState } from 'react';
import { Empty, Space, Spin, Tooltip, Typography } from 'antd';
import { apiGet } from '../../lib/api';
import { PerfTrend, formatMs } from './types';

const WIDTH = 680;
const HEIGHT = 170;
/** Marges du cadre : à gauche les durées, en bas les dates. */
const MARGIN = { top: 8, right: 8, bottom: 22, left: 64 };
const GAP = 2;
const MAX_BAR_WIDTH = 28;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** "2026-08-20" → "20/08" */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/**
 * Tendance quotidienne d'un workflow : une barre par jour, hauteur = médiane de
 * durée (rouge dès qu'il y a eu des échecs), axes durée / date. SVG maison :
 * un graphe de cette taille n'a pas besoin d'une lib de charts.
 */
export function PerfTrendChart({
  instanceId,
  externalWorkflowId,
  days,
}: {
  instanceId: string;
  externalWorkflowId: string;
  days: number;
}) {
  const [trend, setTrend] = useState<PerfTrend | null>(null);

  useEffect(() => {
    setTrend(null);
    apiGet<PerfTrend>(
      `/performance/trend/${instanceId}/${encodeURIComponent(externalWorkflowId)}?days=${days}`,
    ).then(setTrend);
  }, [instanceId, externalWorkflowId, days]);

  if (!trend) return <Spin size="small" />;
  if (trend.buckets.length === 0) {
    return <Empty description="Pas encore d'historique" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const max = Math.max(...trend.buckets.map((b) => b.p50Ms ?? 0), 1);
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(4, PLOT_WIDTH / trend.buckets.length - GAP));
  // Une date sur N pour que l'axe reste lisible quand les jours s'accumulent.
  const labelEvery = Math.max(1, Math.ceil(trend.buckets.length / 8));
  const yTicks = [0, 0.5, 1];

  return (
    <Space direction="vertical" size={4} style={{ width: '100%', maxWidth: WIDTH }}>
      <Typography.Text type="secondary">Médiane par jour · rouge = échecs</Typography.Text>
      {/* viewBox + largeur fluide : le graphe suit la place disponible au lieu de déborder. */}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', maxWidth: WIDTH, height: 'auto', display: 'block' }}
        role="img"
        aria-label="Tendance de durée"
      >
        {/* Ordonnée : durées, avec lignes de repère */}
        {yTicks.map((tick) => {
          const y = MARGIN.top + PLOT_HEIGHT - tick * PLOT_HEIGHT;
          return (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y}
                y2={y}
                stroke="#e5e5e5"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
              />
              <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#888">
                {formatMs(tick * max)}
              </text>
            </g>
          );
        })}
        {/* Barres + abscisse : une barre par jour, la date sous une barre sur N */}
        {trend.buckets.map((bucket, index) => {
          const height = Math.max(2, ((bucket.p50Ms ?? 0) / max) * PLOT_HEIGHT);
          const x = MARGIN.left + index * (barWidth + GAP);
          const showLabel = index % labelEvery === 0 || index === trend.buckets.length - 1;
          return (
            <g key={bucket.date}>
              <Tooltip
                title={`${bucket.date} — ${bucket.executions} exéc., ${bucket.errors} échec(s), P50 ${formatMs(bucket.p50Ms)}, P95 ${formatMs(bucket.p95Ms)}`}
              >
                <rect
                  x={x}
                  y={MARGIN.top + PLOT_HEIGHT - height}
                  width={barWidth}
                  height={height}
                  rx={2}
                  fill={bucket.errors > 0 ? '#ff4d4f' : '#1677ff'}
                  opacity={0.85}
                />
              </Tooltip>
              {showLabel && (
                <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="#888">
                  {dayLabel(bucket.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Space>
  );
}
