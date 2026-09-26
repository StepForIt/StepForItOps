'use client';

import React from 'react';
import { Popover, Tag } from 'antd';
import { BRAND } from '../lib/brand/colors';
import { useTranslations } from 'next-intl';

export interface FindingLocation {
  /** Ligne fautive dans le code du nœud, 1-indexée comme l'éditeur n8n. */
  line?: number;
  /** Extrait avec son contexte. */
  snippet?: string;
  /** Numéro de la première ligne de l'extrait. */
  snippetStart?: number;
}

/**
 * Repère « L42 » d'un finding de code, avec l'extrait au survol. Sans lui, traiter
 * une remarque impose de rouvrir n8n et de relire le nœud entier pour retrouver
 * la ligne visée — c'est là que passait l'essentiel du temps.
 */
export function FindingCode({ line, snippet, snippetStart }: FindingLocation) {
  const t = useTranslations('reviewTools.findingCode');
  if (!line) return null;
  const badge = (
    <Tag color="default" style={{ fontFamily: 'monospace', margin: 0 }}>
      L{line}
    </Tag>
  );
  if (!snippet) return badge;

  return (
    <Popover
      placement="left"
      title={t('line', { line })}
      content={<CodeBlock snippet={snippet} start={snippetStart ?? line} highlight={line} />}
    >
      <span style={{ cursor: 'help' }}>{badge}</span>
    </Popover>
  );
}

/** Extrait numéroté, ligne fautive surlignée. */
export function CodeBlock({
  snippet,
  start,
  highlight,
}: {
  snippet: string;
  start: number;
  highlight?: number;
}) {
  return (
    <pre
      style={{
        margin: 0,
        maxWidth: 640,
        maxHeight: 260,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        background: BRAND.papier,
        padding: '8px 4px',
        borderRadius: 4,
      }}
    >
      {snippet.split('\n').map((text, index) => {
        const number = start + index;
        const isFaulty = number === highlight;
        return (
          <div
            key={number}
            style={{
              background: isFaulty ? BRAND.papier : undefined,
              fontWeight: isFaulty ? 600 : undefined,
              padding: '0 8px',
              whiteSpace: 'pre',
            }}
          >
            <span style={{ color: '#bbb', userSelect: 'none' }}>{String(number).padStart(3, ' ')} </span>
            {text}
          </div>
        );
      })}
    </pre>
  );
}
