'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useIsMobile } from './mobile/use-is-mobile';

export interface BarAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Geste destructeur : bouton rouge sur desktop, entrée rouge dans le menu. */
  danger?: boolean;
  /** Ce que l'action fait, quand le libellé seul ne le dit pas. */
  hint?: string;
}

/**
 * Une barre d'actions : ce qu'on garde sous la main (`primary`) et le reste.
 *
 * `collapse` dit QUAND le reste passe dans un menu « ⋯ » : `mobile` (défaut) le
 * garde en boutons sur grand écran, où la place ne manque pas ; `always` le
 * range toujours, pour une page qui en aligne treize — là, tout montrer ne
 * hiérarchise plus rien, sur aucun écran.
 */
export function ActionBar({
  actions,
  primary,
  collapse = 'mobile',
}: {
  actions: BarAction[];
  primary?: React.ReactNode;
  collapse?: 'mobile' | 'always';
}) {
  const mobile = useIsMobile();
  const t = useTranslations('shell.actionBar');
  const collapsed = collapse === 'always' || mobile;
  if (!collapsed) {
    return (
      <Space wrap>
        {actions.map((action) => (
          <Tooltip key={action.key} title={action.hint}>
            <Button
              icon={action.icon}
              danger={action.danger}
              disabled={action.disabled}
              loading={action.loading}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          </Tooltip>
        ))}
        {primary}
      </Space>
    );
  }
  return (
    <Space wrap>
      {primary}
      <Dropdown
        trigger={['click']}
        menu={{
          items: actions.map((action) => ({
            key: action.key,
            // Une entrée de menu n'a pas de survol sur mobile : l'explication suit le libellé.
            label: action.hint ? <Tooltip title={action.hint}>{action.label}</Tooltip> : action.label,
            icon: action.icon,
            danger: action.danger,
            disabled: action.disabled || action.loading,
          })),
          onClick: ({ key }) => actions.find((action) => action.key === key)?.onClick(),
        }}
      >
        <Button icon={<MoreOutlined />} aria-label={t('more')} />
      </Dropdown>
    </Space>
  );
}
