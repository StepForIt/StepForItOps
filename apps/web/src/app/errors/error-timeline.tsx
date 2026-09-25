'use client';

import React from 'react';
import { Empty } from 'antd';
import { OTHERS_COLOR } from './error-chart-colors';
import type { ErrorStats } from './types';

const WIDTH = 900;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

interface Props {
  stats: ErrorStats;
  colors: Map<string, string>;
  /** Jour sélectionné (YYYY-MM-DD) pour filtrer le tableau. */
  selected?: string | null;
  onSelectDay: (date: string | null) => void;
}

/**
 * Quand les erreurs sont tombées : une barre par jour, empilée par workflow.
 * Fait main en SVG — deux graphes ne justifient pas une lib de charts.
 */
export function ErrorTimeline({ stats, colors, selected, onSelectDay }: Props) {
  if (stats.total === 0) {
    return <Empty description="Aucune erreur sur la période" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / stats.buckets.length;
  const barWidth = Math.max(2, Math.min(28, slot * 0.7));
  const yMax = niceMax(Math.max(...stats.buckets.map((bucket) => bucket.total)));
  const y = (value: number) => PAD.top + plotHeight - (value / yMax) * plotHeight;
  const labelEvery = Math.ceil(stats.buckets.length / 12);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label="Erreurs par jour">
      {[0, yMax / 2, yMax].map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#f0f0f0" />
          <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="#8c8c8c">
            {Math.round(tick)}
          </text>
        </g>
      ))}

      {stats.buckets.map((bucket, index) => {
        const x = PAD.left + index * slot + (slot - barWidth) / 2;
        const isSelected = selected === bucket.date;
        let stackTop = 0;
        return (
          <g
            key={bucket.date}
            onClick={() => onSelectDay(isSelected || bucket.total === 0 ? null : bucket.date)}
            style={{ cursor: bucket.total > 0 ? 'pointer' : 'default' }}
          >
            {/* Zone de clic sur toute la hauteur, même les jours sans erreur */}
            <rect
              x={PAD.left + index * slot}
              y={PAD.top}
              width={slot}
              height={plotHeight}
              fill={isSelected ? '#e6f4ff' : 'transparent'}
            />
            {Object.entries(bucket.byWorkflow)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => {
                const height = (count / yMax) * plotHeight;
                const yTop = y(stackTop) - height;
                stackTop += count;
                return (
                  <rect
                    key={key}
                    x={x}
                    y={yTop}
                    width={barWidth}
                    height={Math.max(1, height)}
                    fill={colors.get(key) ?? OTHERS_COLOR}
                    opacity={selected && !isSelected ? 0.35 : 1}
                  >
                    <title>{`${bucket.date} — ${count} erreur(s)`}</title>
                  </rect>
                );
              })}
            {index % labelEvery === 0 && (
              <text
                x={PAD.left + index * slot + slot / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={11}
                fill="#8c8c8c"
              >
                {bucket.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Borne haute « ronde » pour que les graduations tombent juste. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}
