'use client';

import React, { useState } from 'react';
import { List } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { useInvalidate, useUpdate } from '@refinedev/core';
import { Button, Popconfirm, Switch, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { RobotOutlined } from '@ant-design/icons';
import { AiSettingsModal } from '../../components/ai-settings-modal';
import { PlatformSettingsCard } from '../../components/platform-settings-card';
import { EnvChainCard } from '../../components/env-chain-card';
import { NodeCatalogCard } from '../../components/node-catalog-card';
import { CommunityPackageDocsCard } from '../../components/community-package-docs-card';
import { useEnabledModules } from '../../lib/enabled-modules';
import { useTranslations } from 'next-intl';

interface ModuleView {
  id: string;
  name: string;
  description: string;
  core: boolean;
  enabled: boolean;
}

/**
 * Ce qui S'ARRÊTE quand on coupe un module — nommé avant le clic, comme le fait
 * déjà l'archivage d'un workflow (workflow-actions.tsx). Couper un module a un
 * effet immédiat côté serveur (crons, écoute d'événements) : l'énoncer évite de
 * l'apprendre après coup. Sans entrée dédiée, on retombe sur un effet générique.
 */
const MODULE_DISABLE_EFFECTS = {
  monitoring: 'monitoring',
  performance: 'performance',
  notifier: 'notifier',
  versioning: 'versioning',
  verifier: 'verifier',
  'js-checker': 'jsChecker',
  'field-checker': 'fieldChecker',
  'remote-schema': 'remoteSchema',
  tester: 'tester',
  'env-switcher': 'envSwitcher',
  organizer: 'organizer',
  'doc-schema': 'docSchema',
  'dep-graph': 'depGraph',
  optimizer: 'optimizer',
  'model-audit': 'modelAudit',
  'ai-cost': 'aiCost',
  'app-logs': 'appLogs',
  'resource-discovery': 'resourceDiscovery',
  'config-transfer': 'configTransfer',
  dashboard: 'dashboard',
  'assistant-learning': 'assistantLearning',
  'workflow-chat': 'workflowChat',
} as const;

type DisableEffectKey = (typeof MODULE_DISABLE_EFFECTS)[keyof typeof MODULE_DISABLE_EFFECTS] | 'default';

function disableEffectKey(module: ModuleView): DisableEffectKey {
  return (MODULE_DISABLE_EFFECTS as Record<string, DisableEffectKey>)[module.id] ?? 'default';
}

export default function ModulesPage() {
  const t = useTranslations('settings.modules');
  const tc = useTranslations('common');
  const { tableProps } = useTable<ModuleView>({ resource: 'modules', pagination: { mode: 'off' } });
  const { mutate } = useUpdate();
  const invalidate = useInvalidate();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const { refresh: refreshMenu } = useEnabledModules();

  const toggle = (record: ModuleView, enabled: boolean) => {
    mutate(
      { resource: 'modules', id: record.id, values: { enabled } },
      {
        onSuccess: () => {
          invalidate({ resource: 'modules', invalidates: ['list'] });
          // le menu se cale sur les modules activés : il doit suivre le basculement
          refreshMenu();
        },
      },
    );
  };

  return (
    <List
      title={t('title')}
      headerButtons={
        <Button icon={<RobotOutlined />} onClick={() => setAiModalOpen(true)}>
          {t('aiSettings')}
        </Button>
      }
    >
      <PlatformSettingsCard />
      <EnvChainCard />
      <NodeCatalogCard />
      <CommunityPackageDocsCard />
      <Table {...tableProps} rowKey="id" pagination={false}>
        <Table.Column<ModuleView>
          dataIndex="name"
          title={t('columns.module')}
          sorter={(a, b) => a.name.localeCompare(b.name)}
          defaultSortOrder="ascend"
        />
        <Table.Column dataIndex="description" title={t('columns.description')} />
        <Table.Column
          dataIndex="core"
          title={tc('columns.type')}
          render={(core: boolean) => (core ? <Tag color="purple">core</Tag> : <Tag>{t('optional')}</Tag>)}
        />
        <Table.Column<ModuleView>
          dataIndex="enabled"
          title={t('columns.enabled')}
          render={(enabled: boolean, record) => (
            // Activer est direct ; DÉSACTIVER passe par une confirmation qui nomme
            // l'effet — l'interrupteur reste sur ON tant qu'elle n'est pas validée
            // (onChange ignore la valeur `false`, seul onConfirm coupe vraiment).
            <Popconfirm
              title={t('disableConfirm', { name: record.name })}
              description={
                <div style={{ maxWidth: 320 }}>{t(`disableEffects.${disableEffectKey(record)}`)}</div>
              }
              okText={t('disable')}
              cancelText={tc('cancel')}
              okButtonProps={{ danger: true }}
              disabled={record.core || !enabled}
              onConfirm={() => toggle(record, false)}
            >
              <Switch
                checked={enabled}
                disabled={record.core}
                onChange={(value) => {
                  if (value) toggle(record, true);
                }}
              />
            </Popconfirm>
          )}
        />
      </Table>
      <AiSettingsModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onChanged={() => undefined} />
    </List>
  );
}
