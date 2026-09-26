'use client';

import React from 'react';
import { Alert, Button, Space, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, CopyOutlined, RocketOutlined, TagOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { WorkflowFamily } from '../workflow-row';
import { BulkEnvModal } from './bulk-env-modal';
import { BulkEnvAction } from './types';

const BUTTONS: Array<{ action: BulkEnvAction; icon: React.ReactNode }> = [
  { action: 'promote', icon: <RocketOutlined /> },
  { action: 'duplicate', icon: <CopyOutlined /> },
  { action: 'mark', icon: <TagOutlined /> },
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
  const t = useTranslations('workflowsList.bulkEnv');
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
            <Typography.Text strong>{t('selected', { count: families.length })}</Typography.Text>
            {BUTTONS.map((button) => (
              <Tooltip key={button.action} title={t(`hints.${button.action}`)}>
                <Button size="small" icon={button.icon} onClick={() => setAction(button.action)}>
                  {t(`actions.${button.action}`)}
                </Button>
              </Tooltip>
            ))}
            <Button size="small" type="link" onClick={onClear}>
              {t('clearAll')}
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
