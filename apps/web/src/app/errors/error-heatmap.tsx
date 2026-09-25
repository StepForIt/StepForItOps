'use client';

import React from 'react';
import { Empty } from 'antd';
import { heatColor } from './error-chart-colors';
import type { ErrorStats } from './types';

const CELL = 15;
const GAP = 3;
const ROW = CELL + GAP;
const LABEL_WIDTH = 220;
const HEADER_HEIGHT = 18;
const MAX_ROWS = 15;

interface Props {
  stats: ErrorStats;
  selected?: { externalWorkflowId?: string | null; date?: string | null };
  onSelectCell: (externalWorkflowId: string | null, date: string | null) => void;
}

/**
 * Qui casse, et quand : une ligne par workflow, une colonne par jour.
 * Sépare l'accident isolé (une case foncée) du workflow qui pisse le sang (une ligne entière).
 */
export function ErrorHeatmap({ stats, selected, onSelectCell }: Props) {
  if (stats.total === 0) {
    return <Empty description="Aucune erreur sur la période" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const workflows = stats.workflows.slice(0, MAX_ROWS);
  const width = LABEL_WIDTH + stats.buckets.length * ROW;
  const height = HEADER_HEIGHT + workflows.length * ROW + 4;
  const max = Math.max(
    1,
    ...workflows.flatMap((workflow) =>
      stats.buckets.map((bucket) => bucket.byWorkflow[workflow.externalWorkflowId] ?? 0),
    ),
  );
  const labelEvery = Math.ceil(stats.buckets.length / 15);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Erreurs par workflow et par jour">
        {stats.buckets.map((bucket, index) =>
          index % labelEvery === 0 ? (
            <text
              key={bucket.date}
              x={LABEL_WIDTH + index * ROW + CELL / 2}
              y={12}
              textAnchor="middle"
              fontSize={10}
              fill="#8c8c8c"
            >
              {bucket.date.slice(5)}
            </text>
          ) : null,
        )}

        {workflows.map((workflow, row) => {
          const y = HEADER_HEIGHT + row * ROW;
          const rowSelected = selected?.externalWorkflowId === workflow.externalWorkflowId;
          return (
            <g key={workflow.externalWorkflowId}>
              <text
                x={LABEL_WIDTH - 8}
                y={y + CELL - 3}
                textAnchor="end"
                fontSize={12}
                fill={rowSelected ? '#1677ff' : '#434343'}
                fontWeight={rowSelected ? 600 : 400}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectCell(rowSelected ? null : workflow.externalWorkflowId, null)}
              >
                {truncate(workflow.name, 30)}
                <title>{`${workflow.name} — ${workflow.total} erreur(s) sur la période`}</title>
              </text>
              {stats.buckets.map((bucket, column) => {
                const count = bucket.byWorkflow[workflow.externalWorkflowId] ?? 0;
                const dimmed =
                  (selected?.externalWorkflowId && !rowSelected) ||
                  (selected?.date && selected.date !== bucket.date);
                return (
                  <rect
                    key={bucket.date}
                    x={LABEL_WIDTH + column * ROW}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={heatColor(count, max)}
                    opacity={dimmed ? 0.35 : 1}
                    style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                    onClick={() => count > 0 && onSelectCell(workflow.externalWorkflowId, bucket.date)}
                  >
                    <title>{`${workflow.name}\n${bucket.date} — ${count} erreur(s)`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      {stats.workflows.length > MAX_ROWS && (
        <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 8 }}>
          +{stats.workflows.length - MAX_ROWS} workflow(s), dans le tableau.
        </div>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
