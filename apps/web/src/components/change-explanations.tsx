'use client';

import React from 'react';
import { Typography } from 'antd';

export interface ChangeExplanation {
  text: string;
  path?: string;
  level: 'info' | 'warning';
}

/**
 * Ce que la modification fait, en français. Le point orange marque ce qui déborde du
 * nœud (exécution coupée, credential, câblage) : sur une proposition à dix nœuds,
 * c'est ce qu'on veut repérer sans tout lire.
 */
export function ChangeExplanations({ explanations }: { explanations: ChangeExplanation[] }) {
  if (explanations.length === 0) {
    return <Typography.Text type="secondary">Sans effet sur l&apos;exécution</Typography.Text>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {explanations.map((explanation, index) => (
        <li
          key={`${explanation.path ?? ''}:${index}`}
          style={{ marginBottom: 2, color: explanation.level === 'warning' ? '#ad4e00' : undefined }}
        >
          {explanation.text}
        </li>
      ))}
    </ul>
  );
}
