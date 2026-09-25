'use client';

import React from 'react';
import { Card } from 'antd';
import type { CardProps } from 'antd';
import { useIsMobile } from './use-is-mobile';

/**
 * `Card` dont les boutons d'en-tête passent dans le corps sur mobile : côte à
 * côte avec le titre, ils ne lui laissaient que « Catalogue des t… », voire rien.
 * Sur desktop, c'est une `Card` ordinaire.
 */
export function ResponsiveCard({ extra, children, ...rest }: CardProps) {
  const mobile = useIsMobile();
  return (
    <Card {...rest} extra={mobile ? undefined : extra}>
      {mobile && extra && <div style={{ marginBottom: 12 }}>{extra}</div>}
      {children}
    </Card>
  );
}
