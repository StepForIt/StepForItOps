'use client';

import React from 'react';
import { Tooltip, Typography } from 'antd';

const { Text } = Typography;

const SUMMARY =
  'StepForIt Ops — Business Source License 1.1. Usage libre, y compris commercial, ' +
  'y compris pour piloter les instances n8n de vos clients. En faire une offre hébergée ' +
  "ou revendue n'est pas couvert : mathieu@stepforit.fr.";

/**
 * Mention de licence, en pied du menu latéral.
 *
 * La BUSL impose d'afficher la licence sur chaque copie, originale ou modifiée.
 * L'intérêt n'est pas informatif — personne ne lit un pied de page — mais
 * probatoire : la retirer devient un geste volontaire et daté dans un dépôt.
 */
export function LicenseNotice({ collapsed }: { collapsed: boolean }) {
  return (
    <Tooltip placement="right" title={SUMMARY}>
      <div
        style={{
          padding: collapsed ? '12px 4px' : '12px 12px',
          textAlign: collapsed ? 'center' : 'left',
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.4 }}>
          {collapsed ? 'BUSL' : 'StepForIt Ops · BUSL 1.1'}
        </Text>
      </div>
    </Tooltip>
  );
}
