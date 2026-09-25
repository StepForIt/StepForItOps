'use client';

import React from 'react';
import { Space, Tag, Tooltip } from 'antd';
import { WorkflowFamily } from './workflow-row';
import { useEnvColor } from '../../lib/envs';

/** Les environnements d'un workflow métier, et ses exemplaires dont l'env n'est pas déclaré. */
export function FamilyEnvTags({ family }: { family: Pick<WorkflowFamily, 'envs' | 'unknownEnvCount'> }) {
  const envColor = useEnvColor();
  return (
    <Space size={4}>
      {family.envs.map((env) => (
        <Tag key={env} color={envColor(env)}>
          {env}
        </Tag>
      ))}
      {family.unknownEnvCount > 0 && (
        <Tooltip title="Déclarable depuis le bouton Environnements">
          <Tag>{family.unknownEnvCount} sans env</Tag>
        </Tooltip>
      )}
    </Space>
  );
}
