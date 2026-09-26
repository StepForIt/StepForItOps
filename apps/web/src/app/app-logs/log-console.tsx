'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Empty } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { AppLogEntry, LEVEL_COLORS } from './types';
import { BRAND } from '../../lib/brand/colors';

/** Distance au bas du journal en deçà de laquelle on considère que le lecteur SUIT le flux. */
const FOLLOW_SLACK_PX = 40;

/** Heure seule : la date se lit dans l'infobulle, et un journal se lit à la seconde. */
function timeOf(iso: string, locale: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleTimeString(locale, { hour12: false });
}

/**
 * Le journal, dans l'ordre d'arrivée : la ligne la plus récente en bas, comme un
 * `docker logs -f`. Le défilement ne suit le flux que si le lecteur y était
 * DÉJÀ — sinon une nouvelle ligne lui arracherait des yeux celle qu'il lit.
 */
export function LogConsole({ entries }: { entries: AppLogEntry[] }) {
  const t = useTranslations('misc.appLogs.console');
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Avant le rendu de la nouvelle ligne : après, le conteneur a déjà grandi et
  // « suivait-il le flux ? » ne se répond plus.
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_SLACK_PX;
  });

  useEffect(() => {
    const node = container.current;
    if (node && atBottom.current) node.scrollTop = node.scrollHeight;
  }, [entries]);

  return (
    <div
      ref={container}
      style={{
        height: '60vh',
        overflow: 'auto',
        background: '#141414',
        borderRadius: 8,
        padding: '8px 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {entries.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: BRAND.slate }}>{t('empty')}</span>}
          style={{ marginTop: 80 }}
        />
      ) : (
        entries.map((entry) => (
          <div key={entry.seq} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span style={{ color: BRAND.slate }} title={entry.at}>
              {timeOf(entry.at, locale)}
            </span>{' '}
            <span style={{ color: LEVEL_COLORS[entry.level] ?? BRAND.slateLight, fontWeight: 600 }}>
              {entry.level.toUpperCase()}
            </span>{' '}
            <span style={{ color: BRAND.warning }}>[{entry.context}]</span>{' '}
            <span style={{ color: BRAND.craie }}>{entry.message}</span>
            {entry.stack && (
              // Repliée : une pile fait quinze lignes, et on ne les lit que
              // pour l'erreur sur laquelle on s'arrête.
              <details style={{ margin: '2px 0 6px 0' }}>
                <summary style={{ color: BRAND.slate, cursor: 'pointer' }}>{t('stack')}</summary>
                <pre style={{ color: BRAND.slateLight, margin: '4px 0 0 0', whiteSpace: 'pre-wrap' }}>
                  {entry.stack}
                </pre>
              </details>
            )}
          </div>
        ))
      )}
    </div>
  );
}
