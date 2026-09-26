'use client';

import React from 'react';
import { List } from '@refinedev/antd';
import { CrudFilters, useInvalidate, useSelect } from '@refinedev/core';
import { Dropdown, Modal, Segmented, Select, Space, Tag, message } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { RestoreModal } from './restore-modal';
import { ExportModal } from './export-modal';
import { CleanupModal } from './cleanup-modal';
import { VersionDiffModal } from './diff-modal';
import { LatestVersionsTable } from './latest-table';
import { VersionFamiliesTable } from './families-table';
import { VersionHandlers } from './version-actions';

interface ArchiveMove {
  workflowName: string;
  targetName: string;
  from: string;
  to: string;
}

export default function VersionsList() {
  const t = useTranslations('inventory.versions.page');
  const { scope, instanceName } = useInstanceScope();
  const [onlyWorkflow, setOnlyWorkflow] = usePersistedState<string | null>('workflow', null);
  // Groupé par défaut, comme la liste Workflows : un même workflow métier versionné
  // en dev et en prod se lit sur une ligne, pas à deux endroits de la liste.
  const [grouped, setGrouped] = usePersistedState('grouped', true);
  // Scope connu dès le premier rendu (InstanceScopeGate) : premier chargement déjà filtré.
  const filters: CrudFilters = [
    ...(scope ? [{ field: 'instanceId' as const, operator: 'eq' as const, value: scope }] : []),
    ...(onlyWorkflow ? [{ field: 'workflowId' as const, operator: 'eq' as const, value: onlyWorkflow }] : []),
  ];
  const invalidate = useInvalidate();
  /** Les vues lisent des resources différentes : une action les invalide toutes. */
  const refreshLists = () => {
    invalidate({ resource: 'versions', invalidates: ['list'] });
    invalidate({ resource: 'versions/latest', invalidates: ['list'] });
    invalidate({ resource: 'versions/families', invalidates: ['list'] });
  };
  const [exportingAll, setExportingAll] = React.useState(false);
  const [cleanupOpen, setCleanupOpen] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);

  // Changer de scope remet la liste à plat : le workflow filtré n'est plus le sien.
  // Au montage, le scope ne change pas : le workflow retenu reste.
  const lastScope = React.useRef(scope);
  React.useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setOnlyWorkflow(null);
  }, [scope, setOnlyWorkflow]);

  const exportAll = async (force: boolean) => {
    setExportingAll(true);
    try {
      const result = await apiPost<{ exported: number; skipped: number; failed: number }>(
        `/versions/export-all${force ? '?force=1' : ''}`,
      );
      const done =
        result.exported === 0 ? t('nothingToExport') : t('exportDone', { exported: result.exported });
      if (result.failed) message.warning(t('exportPartial', { done, failed: result.failed }));
      else message.success(done);
      refreshLists();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setExportingAll(false);
    }
  };
  /**
   * Range les exports des workflows retirés côté n8n sans attendre la synchro
   * horaire. Le détail des déplacements est montré tel quel : c'est la passe de
   * reprise du retard, un compteur ne dirait pas QUELS fichiers ont bougé.
   */
  const archiveSweep = async () => {
    setSweeping(true);
    try {
      const result = await apiPost<{ inspected: number; moved: ArchiveMove[]; failed: number }>(
        `/versions/archive-sweep${scope ? `?instanceId=${scope}` : ''}`,
      );
      if (result.moved.length === 0) {
        if (result.failed) message.warning(t('nothingMovedFailed', { failed: result.failed }));
        else message.success(t('nothingToMove'));
        return;
      }
      Modal.info({
        title: t('movedTitle', { count: result.moved.length }),
        width: 720,
        content: (
          <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
            {result.failed > 0 && <Tag color="red">{t('movedFailed', { count: result.failed })}</Tag>}
            {result.moved.map((move) => (
              <div key={`${move.targetName}/${move.from}`}>
                <strong>{move.workflowName}</strong> <Tag>{move.targetName}</Tag>
                <br />
                <code style={{ fontSize: 12 }}>
                  {move.from} → {move.to}
                </code>
              </div>
            ))}
          </Space>
        ),
      });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSweeping(false);
    }
  };

  const { options: workflowOptions } = useSelect({
    resource: 'workflows',
    optionLabel: 'name',
    optionValue: 'id',
    pagination: { pageSize: 200 },
    filters: scope ? [{ field: 'instanceId', operator: 'eq', value: scope }] : [],
  });

  // Actions unitaires : confirmation détaillée dans une modale (impact / destinations)
  const [restoreId, setRestoreId] = React.useState<string | null>(null);
  const [exportId, setExportId] = React.useState<string | null>(null);
  const [diffId, setDiffId] = React.useState<string | null>(null);

  const handlers: VersionHandlers = {
    onDiff: setDiffId,
    onExport: setExportId,
    onRestore: setRestoreId,
  };

  const closeRestore = () => {
    setRestoreId(null);
    refreshLists();
  };

  const closeExport = () => {
    setExportId(null);
    refreshLists();
  };

  return (
    <List
      headerButtons={
        <Dropdown.Button
          type="primary"
          loading={exportingAll || sweeping}
          onClick={() => exportAll(false)}
          menu={{
            items: [
              { key: 'force', label: t('forceExport') },
              { key: 'cleanup', label: t('cleanup') },
              {
                key: 'sweep',
                label: scope ? t('sweepScoped') : t('sweepAll'),
              },
            ],
            onClick: ({ key }) => {
              if (key === 'cleanup') setCleanupOpen(true);
              else if (key === 'sweep') void archiveSweep();
              else void exportAll(true);
            },
          }}
        >
          <CloudUploadOutlined /> {t('exportAll')}
        </Dropdown.Button>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder={t('filterWorkflow')}
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 320, maxWidth: '100%' }}
          options={workflowOptions}
          value={onlyWorkflow ?? undefined}
          onChange={(value?: string) => setOnlyWorkflow(value || null)}
        />
        <Segmented
          value={grouped ? 'grouped' : 'flat'}
          onChange={(value) => setGrouped(value === 'grouped')}
          options={[
            { value: 'grouped', label: t('grouped') },
            { value: 'flat', label: t('flat') },
          ]}
        />
      </Space>
      {grouped ? (
        <VersionFamiliesTable
          filters={filters}
          scope={scope}
          instanceName={instanceName}
          handlers={handlers}
        />
      ) : (
        <LatestVersionsTable
          filters={filters}
          scope={scope}
          instanceName={instanceName}
          handlers={handlers}
        />
      )}
      <RestoreModal versionId={restoreId} onClose={closeRestore} />
      <ExportModal versionId={exportId} onClose={closeExport} />
      <VersionDiffModal versionId={diffId} onClose={() => setDiffId(null)} />
      <CleanupModal open={cleanupOpen} onClose={() => setCleanupOpen(false)} />
    </List>
  );
}
