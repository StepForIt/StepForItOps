'use client';

import React from 'react';
import { Space, Tag, Tooltip, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import { WorkflowRow } from '../app/workflows/workflow-row';
import { useEnvColor } from '../lib/envs';

/**
 * Une ligne de résultat. L'aspect « sélectionné » suit le clavier autant que la
 * souris : c'est le seul repère de ce que fera la touche Entrée.
 */
export function PaletteRow({
  icon,
  label,
  detail,
  active,
  extra,
  onSelect,
  onHover,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: React.ReactNode;
  active: boolean;
  extra?: React.ReactNode;
  onSelect: () => void;
  onHover: () => void;
}) {
  const { token } = theme.useToken();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        cursor: 'pointer',
        background: active ? token.controlItemBgActive : undefined,
      }}
    >
      <span style={{ color: token.colorTextSecondary, display: 'flex' }}>{icon}</span>
      <Typography.Text ellipsis style={{ flex: 1 }}>
        {label}
      </Typography.Text>
      {detail && (
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {detail}
        </Typography.Text>
      )}
      {extra}
    </div>
  );
}

/**
 * Les environnements d'un workflow métier, cliquables : Entrée ouvre la prod,
 * mais aller voir la dev ne doit pas imposer de repasser par la liste.
 */
export function EnvTags({
  members,
  target,
  onOpen,
}: {
  members: WorkflowRow[];
  target: WorkflowRow;
  onOpen: (member: WorkflowRow) => void;
}) {
  const envColor = useEnvColor();
  const t = useTranslations('shell.commandPalette');
  return (
    <Space size={4} onClick={(event) => event.stopPropagation()}>
      {members.map((member) => (
        <Tooltip key={member.id} title={t('openMember', { name: member.name })}>
          <Tag
            color={member.env ? envColor(member.env) : undefined}
            style={{
              marginInlineEnd: 0,
              cursor: 'pointer',
              opacity: member.id === target.id ? 1 : 0.65,
            }}
            onClick={() => onOpen(member)}
          >
            {member.env ?? '?'}
          </Tag>
        </Tooltip>
      ))}
    </Space>
  );
}
