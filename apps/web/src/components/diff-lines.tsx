'use client';

import React from 'react';
import { Typography } from 'antd';
import { BRAND } from '../lib/brand/colors';
import { useTranslations } from 'next-intl';

export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  text: string;
}

/** Au-delà de ce nombre de lignes identiques d'affilée, on replie. */
const COLLAPSE_AFTER = 6;
const KEEP_AROUND = 2;

type Row = DiffLine | { type: 'skip'; count: number };

/** Replie les longues plages inchangées : la revue reste lisible sur un gros nœud. */
function collapse(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let run: DiffLine[] = [];

  const flush = (last: boolean) => {
    if (run.length === 0) return;
    if (run.length <= COLLAPSE_AFTER) {
      rows.push(...run);
    } else {
      const head = rows.length === 0 ? [] : run.slice(0, KEEP_AROUND);
      const tail = last ? [] : run.slice(-KEEP_AROUND);
      rows.push(...head, { type: 'skip', count: run.length - head.length - tail.length }, ...tail);
    }
    run = [];
  };

  for (const line of lines) {
    if (line.type === 'ctx') {
      run.push(line);
      continue;
    }
    flush(false);
    rows.push(line);
  }
  flush(true);
  return rows;
}

const style: Record<string, React.CSSProperties> = {
  add: { background: BRAND.papier, color: '#237804' },
  del: { background: BRAND.papier, color: BRAND.danger },
  ctx: { color: BRAND.slate },
};

const marker = { add: '+', del: '-', ctx: ' ' } as const;

/** Diff unifié en monospace, avec repli des plages inchangées. */
export function DiffLines({ lines, maxHeight = 360 }: { lines: DiffLine[]; maxHeight?: number }) {
  const t = useTranslations('chat.diff');
  if (lines.length === 0) {
    return <Typography.Text type="secondary">{t('noDifference')}</Typography.Text>;
  }
  return (
    <div
      style={{
        maxHeight,
        overflow: 'auto',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'pre',
      }}
    >
      {collapse(lines).map((row, index) =>
        row.type === 'skip' ? (
          <div key={index} style={{ background: BRAND.papier, color: BRAND.slate, padding: '0 8px' }}>
            ⋯ {t('unchangedLines', { count: row.count })}
          </div>
        ) : (
          <div key={index} style={{ ...style[row.type], padding: '0 8px' }}>
            {marker[row.type]} {row.text}
          </div>
        ),
      )}
    </div>
  );
}
