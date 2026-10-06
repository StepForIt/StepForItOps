'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Tooltip, Typography, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useCommandPalette } from './command-palette';

/** Raccourci affiché : le Mac attend ⌘, le reste Ctrl. */
function shortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

/**
 * Entrée « Rechercher » du menu latéral : le raccourci ⌘K ne s'apprend que s'il
 * est écrit quelque part.
 */
export function CommandSearchMenuItem({ collapsed }: { collapsed: boolean }) {
  const { token } = theme.useToken();
  const { open } = useCommandPalette();
  const t = useTranslations('shell.commandSearch');
  const tc = useTranslations('common');
  const [shortcut, setShortcut] = React.useState('');

  // Lu après le montage : le rendu serveur ne connaît pas la plateforme du visiteur.
  React.useEffect(() => setShortcut(shortcutLabel()), []);

  // Un vrai `<Button>` et non un `<div role="button">` : sans lui, la recherche
  // n'était ni atteignable au clavier ni nommée (axe aria-command-name), là où
  // install-app-button.tsx montrait déjà la bonne façon de faire dans ce menu.
  if (collapsed) {
    return (
      <Tooltip placement="right" title={t('tooltip')}>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Button
            type="text"
            aria-label={t('tooltip')}
            icon={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
            onClick={open}
          />
        </div>
      </Tooltip>
    );
  }

  return (
    <div style={{ padding: '12px 12px 4px' }} onClick={(event) => event.stopPropagation()}>
      <Button
        onClick={open}
        aria-label={t('tooltip')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          height: 'auto',
          padding: '5px 11px',
          textAlign: 'left',
          color: token.colorTextSecondary,
        }}
      >
        <SearchOutlined />
        <span style={{ flex: 1 }}>{tc('search')}</span>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {shortcut}
        </Typography.Text>
      </Button>
    </div>
  );
}
