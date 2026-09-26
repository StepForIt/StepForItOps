'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Grid, theme } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import { ThemedTitleV2, useThemedLayoutContext } from '@refinedev/antd';
import { BrandMark, BrandWordmark } from './brand-mark';

/** Hauteur de la barre : un élément collant de page (`position: sticky`) se pose en dessous. */
export const MOBILE_TOP_BAR_HEIGHT = 56;

/**
 * Barre du haut sur mobile : le titre à gauche, le menu à droite, à portée de pouce.
 *
 * Le bouton que `ThemedSiderV2` pose de lui-même sur mobile est fixé à GAUCHE, à
 * 64 px du haut, par-dessus la page : il recouvrait le premier contrôle de chaque
 * écran (recherche, filtres, boutons). Il est masqué (`.app-sider` dans
 * `globals.css`) et celui-ci ouvre le même tiroir, par le contexte du layout.
 * Même seuil que le sider (`lg`) : en dessous, il n'y a plus de colonne de menu.
 */
export function MobileTopBar() {
  const { token } = theme.useToken();
  const { setMobileSiderOpen } = useThemedLayoutContext();
  const t = useTranslations('shell.mobileTopBar');
  if (Grid.useBreakpoint().lg !== false) return null;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: MOBILE_TOP_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px 0 16px',
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <ThemedTitleV2 collapsed={false} icon={<BrandMark size={26} />} text={<BrandWordmark />} />
      <Button
        type="text"
        size="large"
        icon={<MenuOutlined />}
        aria-label={t('openMenu')}
        onClick={() => setMobileSiderOpen(true)}
      />
    </header>
  );
}
