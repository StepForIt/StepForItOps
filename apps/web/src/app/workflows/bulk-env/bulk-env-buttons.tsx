'use client';

import React from 'react';
import { Alert, Button, Space, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, CopyOutlined, RocketOutlined, TagOutlined } from '@ant-design/icons';
import { WorkflowFamily } from '../workflow-row';
import { BulkEnvModal } from './bulk-env-modal';
import { BulkEnvAction } from './types';

const BUTTONS: Array<{ action: BulkEnvAction; label: string; icon: React.ReactNode; hint: string }> = [
  {
    action: 'promote',
    label: 'Promouvoir',
    icon: <RocketOutlined />,
    hint: 'Vers l’env suivant, aperçu par workflow',
  },
  {
    action: 'duplicate',
    label: 'Dupliquer vers un env',
    icon: <CopyOutlined />,
    hint: 'Copie dans un autre env, même instance',
  },
  {
    action: 'mark',
    label: 'Déclarer l’env',
    icon: <TagOutlined />,
    hint: 'Tag env:x, aucune donnée touchée',
  },
];

/**
 * Gestes d'environnement sur les workflows MÉTIER cochés. Ils ne portent pas sur
 * les exemplaires : on dit « de DEV vers PROD » une fois pour tout le lot, et
 * chaque famille y trouve elle-même son exemplaire de départ et sa cible.
 */
export function FamilyBulkBar({
  families,
  onApplied,
  onClear,
}: {
  families: WorkflowFamily[];
  onApplied: () => void;
  onClear: () => void;
}) {
  const [action, setAction] = React.useState<BulkEnvAction | null>(null);

  return (
    <>
      <Alert
        type="info"
        style={{ marginBottom: 16 }}
        icon={<ApartmentOutlined />}
        showIcon
        message={
          <Space wrap>
            <Typography.Text strong>
              {families.length} workflow{families.length > 1 ? 's' : ''} métier sélectionné
              {families.length > 1 ? 's' : ''}
            </Typography.Text>
            {BUTTONS.map((button) => (
              <Tooltip key={button.action} title={button.hint}>
                <Button size="small" icon={button.icon} onClick={() => setAction(button.action)}>
                  {button.label}
                </Button>
              </Tooltip>
            ))}
            <Button size="small" type="link" onClick={onClear}>
              Tout décocher
            </Button>
          </Space>
        }
      />
      {action && (
        <BulkEnvModal
          action={action}
          families={families}
          open
          onClose={() => setAction(null)}
          onApplied={onApplied}
        />
      )}
    </>
  );
}
