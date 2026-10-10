'use client';

import React from 'react';
import { Button, Card, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { BRAND } from '../../lib/brand/colors';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { legendContent, type LegendContent } from './map-legend';
import { BOX_STYLES, type BoxClass } from './map-style';
import type { WorkflowMapLink, WorkflowMapNode } from './types';

type Arrow = LegendContent['arrows'][number];

/** Les flèches d'exemple sont neutres : sur la carte, chaque workflow a sa propre couleur. */
const NEUTRAL = BOX_STYLES.inactive.color;

const ARROW_STYLE: Record<Arrow, { color: string; dashed: boolean }> = {
  call: { color: NEUTRAL, dashed: false },
  webhook: { color: NEUTRAL, dashed: false },
  tool: { color: NEUTRAL, dashed: false },
  manual: { color: NEUTRAL, dashed: true },
  context: { color: NEUTRAL, dashed: false },
  entry: { color: BRAND.success, dashed: true },
};

/**
 * La légende de la carte, au-dessus du schéma : ce que les boîtes et les flèches veulent dire,
 * sans ouvrir une aide. Elle ne montre que ce qui est à l'écran et se replie pour de bon (mémorisé).
 */
export function WorkflowMapLegend({
  nodes,
  links,
  showEntryPoints,
}: {
  nodes: WorkflowMapNode[];
  links: WorkflowMapLink[];
  showEntryPoints: boolean;
}) {
  const t = useTranslations('inventory.workflowMap.legend');
  // Le texte posé sur la flèche d'exemple est celui de la vraie carte, pas une copie.
  const tp = useTranslations('inventory.workflowMap.page');
  const captions: Partial<Record<Arrow, string>> = {
    webhook: tp('kinds.webhook'),
    tool: tp('kinds.tool'),
    manual: tp('kinds.manual'),
    context: tp('contextLabel', { context: tp('contexts.loop'), count: 3 }),
  };
  const [open, setOpen] = usePersistedState<boolean>('legendOpen', true, {
    validate: (value) => (typeof value === 'boolean' ? value : undefined),
  });
  const content = legendContent(nodes, links, showEntryPoints);

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={t('title')}
      extra={
        <Button type="link" size="small" onClick={() => setOpen(!open)}>
          {open ? t('hide') : t('show')}
        </Button>
      }
      styles={open ? undefined : { body: { display: 'none' } }}
    >
      {open && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>{t('intro')}</Typography.Text>

          <Section title={t('boxesTitle')}>
            {content.boxes.map((box) => (
              <Item
                key={box}
                swatch={<BoxSwatch box={box} />}
                title={t(`boxes.${box}.title`)}
                hint={t(`boxes.${box}.hint`)}
              />
            ))}
          </Section>

          <Section title={t('arrowsTitle')}>
            {content.arrows.map((arrow) => (
              <Item
                key={arrow}
                swatch={<ArrowSwatch arrow={arrow} caption={captions[arrow]} />}
                title={t(`arrows.${arrow}.title`)}
                hint={t(`arrows.${arrow}.hint`)}
              />
            ))}
          </Section>

          <Typography.Text type="secondary">{t('colorsTip')}</Typography.Text>
        </Space>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Typography.Text strong>{title}</Typography.Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '8px 20px',
          marginTop: 6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Item({ swatch, title, hint }: { swatch: React.ReactNode; title: string; hint: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 64px', display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
        {swatch}
      </div>
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}

function BoxSwatch({ box }: { box: BoxClass }) {
  const style = BOX_STYLES[box];
  const dashed = 'dashed' in style && style.dashed;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 48,
        height: 22,
        background: style.fill,
        border: `1.5px ${dashed ? 'dashed' : 'solid'} ${style.stroke}`,
        // Le point d'entrée est une pastille sur la carte (forme « stade » de Mermaid).
        borderRadius: box === 'entry' ? 11 : 4,
      }}
    />
  );
}

function ArrowSwatch({ arrow, caption }: { arrow: Arrow; caption?: string }) {
  const { color, dashed } = ARROW_STYLE[arrow];
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}
    >
      <span style={{ fontSize: 10, color: NEUTRAL, minHeight: 11, whiteSpace: 'nowrap' }}>
        {caption ?? ''}
      </span>
      <svg width="60" height="14" viewBox="0 0 60 14">
        <line
          x1="2"
          y1="7"
          x2="50"
          y2="7"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
        <polygon points="50,2 58,7 50,12" fill={color} />
      </svg>
    </span>
  );
}
