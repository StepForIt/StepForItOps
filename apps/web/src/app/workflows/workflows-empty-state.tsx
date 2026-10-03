'use client';

import React from 'react';
import { useList } from '@refinedev/core';
import { Button } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ListEmptyState } from '../../components/empty-state/list-empty-state';
import { SyncInstancesButton } from '../../components/empty-state/sync-instances-button';
import { workflowsIdleKind } from './empty-state';

/**
 * Liste de workflows vide : les cas communs (aucune instance, recherche, filtres) sont
 * ceux de `ListEmptyState` ; ce qui est propre à la page, c'est la synchro proposée sur
 * place et les archivés, masqués par défaut, qu'on propose d'afficher.
 */
export function WorkflowsEmptyState({
  search,
  filterCount,
  instanceId,
  onSynced,
  onClearSearch,
  onResetFilters,
  onShowArchived,
}: {
  search?: string;
  filterCount: number;
  /** Instance visée par le scope ou le filtre : la synchro ne porte que sur elle. */
  instanceId: string | null;
  onSynced: () => void;
  onClearSearch: () => void;
  onResetFilters: () => void;
  onShowArchived: () => void;
}) {
  const t = useTranslations('workflowsList.empty');
  // Un seul workflow suffit à trancher : on ne lit que le total.
  const { data: archived } = useList({
    resource: 'workflows',
    pagination: { pageSize: 1 },
    filters: [
      { field: 'archived', operator: 'eq', value: 'true' },
      ...(instanceId ? [{ field: 'instanceId', operator: 'eq' as const, value: instanceId }] : []),
    ],
  });
  const archivedCount = archived?.total ?? 0;

  const idle =
    workflowsIdleKind(archivedCount) === 'all-archived'
      ? {
          title: t('allArchived.title'),
          text: t('allArchived.text', { count: archivedCount }),
          actions: (
            <Button type="primary" icon={<InboxOutlined />} onClick={onShowArchived}>
              {t('allArchived.show')}
            </Button>
          ),
        }
      : {
          title: t('notSynced.title'),
          text: t('notSynced.text'),
          actions: <SyncInstancesButton instanceId={instanceId} onSynced={onSynced} />,
        };

  return (
    <ListEmptyState
      needsInstances
      search={search}
      onClearSearch={onClearSearch}
      searchActions={<SyncInstancesButton instanceId={instanceId} onSynced={onSynced} />}
      filterCount={filterCount}
      onResetFilters={onResetFilters}
      idle={idle}
    />
  );
}
