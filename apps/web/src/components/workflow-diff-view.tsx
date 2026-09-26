'use client';

import React from 'react';
import { Collapse, Space, Tabs, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { ChangeExplanation, ChangeExplanations } from './change-explanations';
import { DiffLine, DiffLines } from './diff-lines';

export interface NodeDiff {
  name: string;
  nodeType: string;
  change: 'added' | 'removed' | 'modified' | 'renamed';
  renamedFrom?: string;
  fields: string[];
  lines: DiffLine[];
  explanations: ChangeExplanation[];
}

export interface WorkflowDiff {
  nameChange: { before: string; after: string } | null;
  nodes: NodeDiff[];
  connections: { changed: boolean; lines: DiffLine[]; explanations: ChangeExplanation[] };
  settings: { changed: boolean; lines: DiffLine[]; explanations: ChangeExplanation[] };
  counts: { added: number; removed: number; modified: number; renamed: number };
  hasChanges: boolean;
}

const changeColor: Record<NodeDiff['change'], string> = {
  added: 'green',
  removed: 'red',
  modified: 'blue',
  renamed: 'gold',
};

const shortType = (type: string) => type.split('.').pop() ?? type;

/** En-tête commun aux deux lectures d'un nœud : même repère dans l'onglet clair et dans le JSON. */
export function NodeHeader({ node }: { node: NodeDiff }) {
  const t = useTranslations('chat.diff');
  return (
    <Space size={6} wrap>
      <Tag color={changeColor[node.change]}>{t(`change.${node.change}`)}</Tag>
      {node.renamedFrom && (
        <Typography.Text delete type="secondary">
          {node.renamedFrom}
        </Typography.Text>
      )}
      <b>{node.name}</b>
      <Typography.Text type="secondary">{shortType(node.nodeType)}</Typography.Text>
      {node.fields.length > 0 && (
        <Typography.Text type="secondary">— {node.fields.join(', ')}</Typography.Text>
      )}
    </Space>
  );
}

function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function ConnectionsTitle() {
  const t = useTranslations('chat.diff');
  return (
    <Space size={6}>
      <Tag color="purple">{t('connections.tag')}</Tag>
      <b>{t('connections.title')}</b>
    </Space>
  );
}

function SettingsTitle() {
  const t = useTranslations('chat.diff');
  return (
    <Space size={6}>
      <Tag>{t('settings.tag')}</Tag>
      <b>{t('settings.title')}</b>
    </Space>
  );
}

/** Le compte des nœuds touchés, en une ligne ; rien quand aucun nœud ne bouge (câblage ou réglages seuls). */
export function DiffCounts({ counts }: { counts: WorkflowDiff['counts'] }) {
  const t = useTranslations('chat.diff.counts');
  const parts = (
    [
      [counts.modified, 'modified'],
      [counts.added, 'added'],
      [counts.renamed, 'renamed'],
      [counts.removed, 'removed'],
    ] as const
  )
    .filter(([n]) => n > 0)
    // Le premier porte le mot « nœud », les suivants ne font que le compléter.
    .map(([n, change], i) =>
      i === 0 ? t(`first.${change}`, { count: n }) : t(`rest.${change}`, { count: n }),
    );
  if (parts.length === 0) return null;
  return <Typography.Text>{parts.join(' · ')}</Typography.Text>;
}

/**
 * Deux lectures du MÊME changement — ce qu'il fait, puis le JSON qui le prouve.
 * Un diff brut montre quels caractères bougent, pas qu'on vient de retirer le
 * samedi du planning ; et à plusieurs nœuds modifiés, personne ne relit le JSON.
 *
 * Partagé par la revue d'une proposition IA (avant écriture) et par la
 * comparaison de deux versions de l'historique (après coup) : c'est la même
 * question posée à deux moments.
 */
export function WorkflowDiffView({
  diff,
  maxHeight = 420,
  extraJsonPanels = [],
}: {
  diff: WorkflowDiff;
  maxHeight?: number;
  /** Panneaux ajoutés en fin d'onglet JSON (ex. les opérations demandées à l'IA). */
  extraJsonPanels?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>;
}) {
  const t = useTranslations('chat.diff');
  const connectionsTitle = <ConnectionsTitle />;
  const settingsTitle = <SettingsTitle />;
  const jsonPanels = [
    ...diff.nodes.map((node) => ({
      key: `node:${node.name}`,
      label: <NodeHeader node={node} />,
      children: <DiffLines lines={node.lines} />,
    })),
    ...(diff.connections.changed
      ? [
          {
            key: 'connections',
            label: connectionsTitle,
            children: <DiffLines lines={diff.connections.lines} />,
          },
        ]
      : []),
    ...(diff.settings.changed
      ? [{ key: 'settings', label: settingsTitle, children: <DiffLines lines={diff.settings.lines} /> }]
      : []),
    ...extraJsonPanels,
  ];

  const plain = (
    <Space direction="vertical" size={8} style={{ width: '100%', maxHeight, overflow: 'auto' }}>
      {diff.nodes.map((node) => (
        <Block key={node.name} title={<NodeHeader node={node} />}>
          <ChangeExplanations explanations={node.explanations} />
        </Block>
      ))}
      {diff.connections.changed && (
        <Block title={connectionsTitle}>
          <ChangeExplanations explanations={diff.connections.explanations} />
        </Block>
      )}
      {diff.settings.changed && (
        <Block title={settingsTitle}>
          <ChangeExplanations explanations={diff.settings.explanations} />
        </Block>
      )}
    </Space>
  );

  return (
    <Tabs
      size="small"
      items={[
        { key: 'plain', label: t('tabs.plain'), children: plain },
        {
          key: 'json',
          label: t('tabs.json'),
          children: (
            <Collapse
              size="small"
              items={jsonPanels}
              defaultActiveKey={jsonPanels.slice(0, 3).map((panel) => panel.key)}
            />
          ),
        },
      ]}
    />
  );
}
