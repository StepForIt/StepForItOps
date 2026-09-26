'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { usePersistedState, useTable } from '../../lib/list-memory/use-list-memory';
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Table } from '../../components/resizable-table';
import {
  CloudDownloadOutlined,
  ExportOutlined,
  GroupOutlined,
  MoreOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { ErrorTimeline } from './error-timeline';
import { ErrorHeatmap } from './error-heatmap';
import { ErrorDetailDrawer } from './error-detail-drawer';
import { ErrorGroupsTable } from './error-groups-table';
import { ErrorGroupDrawer } from './error-group-drawer';
import { OTHERS_COLOR, buildColorMap } from './error-chart-colors';
import type { BackfillResult, ErrorGroupRow, ErrorStats, ExecutionErrorRow, RegroupResult } from './types';
import { BRAND } from '../../lib/brand/colors';

const PERIODS = [7, 30, 90];

/** Deux lectures du même historique : le problème (dédoublonné) ou le journal brut. */
const VIEWS = ['groups', 'occurrences'] as const;

/** Page « Erreurs » : quand ça a cassé, sur quel workflow, et ce qui a fail. */
export default function ErrorsPage() {
  const { scope, instances, instanceName } = useInstanceScope();
  const t = useTranslations('health.errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [days, setDays] = usePersistedState('days', 30);
  const [stats, setStats] = useState<ErrorStats>();
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string>();
  const [workflowFilter, setWorkflowFilter] = usePersistedState<string | null>('workflow', null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [search, setSearch] = usePersistedState('search', '');
  const [view, setView] = usePersistedState('view', 'groups', {
    validate: (value) => VIEWS.find((option) => option === value),
  });
  const [selected, setSelected] = useState<ExecutionErrorRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ErrorGroupRow | null>(null);
  const [groupsRefresh, setGroupsRefresh] = useState(0);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillInstance, setBackfillInstance] = useState<string>();
  const [busy, setBusy] = useState(false);

  const { tableProps, setFilters } = useTable<ExecutionErrorRow>({
    resource: 'execution-errors',
    sorters: { initial: [{ field: 'startedAt', order: 'desc' }] },
    syncWithLocation: false,
    // Scope connu dès le premier rendu (InstanceScopeGate) : premier chargement déjà filtré.
    filters: {
      initial: [
        ...(scope ? [{ field: 'instanceId', operator: 'eq' as const, value: scope }] : []),
        { field: 'days', operator: 'eq' as const, value: days },
        ...(workflowFilter
          ? [{ field: 'externalWorkflowId', operator: 'eq' as const, value: workflowFilter }]
          : []),
        ...(search ? [{ field: 'q', operator: 'eq' as const, value: search }] : []),
      ],
    },
  });

  const loadStats = useCallback(() => {
    setLoadingStats(true);
    setStatsError(undefined);
    const params = new URLSearchParams({ days: String(days) });
    if (scope) params.set('instanceId', scope);
    apiGet<ErrorStats>(`/execution-errors/stats?${params.toString()}`)
      .then(setStats)
      .catch((error) => setStatsError((error as Error).message))
      .finally(() => setLoadingStats(false));
  }, [days, scope]);

  useEffect(loadStats, [loadStats]);

  useEffect(() => {
    if (scope) setBackfillInstance(scope);
  }, [scope]);

  // Les filtres des graphes et de la recherche pilotent le tableau
  useEffect(() => {
    setFilters(
      [
        { field: 'instanceId', operator: 'eq', value: scope ?? undefined },
        { field: 'externalWorkflowId', operator: 'eq', value: workflowFilter ?? undefined },
        { field: 'days', operator: 'eq', value: dayFilter ? undefined : days },
        { field: 'from', operator: 'eq', value: dayFilter ? dayStart(dayFilter, 0) : undefined },
        { field: 'to', operator: 'eq', value: dayFilter ? dayStart(dayFilter, 1) : undefined },
        { field: 'q', operator: 'eq', value: search || undefined },
      ],
      'merge',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, workflowFilter, dayFilter, days, search]);

  const colors = useMemo(
    () => buildColorMap((stats?.workflows ?? []).map((workflow) => workflow.externalWorkflowId)),
    [stats],
  );

  const runBackfill = async () => {
    if (!backfillInstance) return;
    setBusy(true);
    try {
      const result = await apiPost<BackfillResult>(
        `/execution-errors/backfill/${backfillInstance}?days=${days}`,
      );
      message.success(t('page.imported', { count: result.imported }));
      setBackfillOpen(false);
      loadStats();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Range les erreurs importées avant la mise en service du regroupement. */
  const runRegroup = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: '2000' });
      if (scope) params.set('instanceId', scope);
      const result = await apiPost<RegroupResult>(`/error-groups/regroup?${params}`);
      message.success(
        result.remaining
          ? t('page.regroupedMore', {
              processed: result.processed,
              groups: result.groups,
              remaining: result.remaining,
            })
          : t('page.regroupedDone', { processed: result.processed, groups: result.groups }),
      );
      loadStats();
      setGroupsRefresh((key) => key + 1);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Rattrapage : la catégorie des problèmes d'avant la fonctionnalité. */
  const runRecategorize = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (scope) params.set('instanceId', scope);
      const result = await apiPost<{ processed: number; changed: number }>(
        `/error-groups/recategorize?${params}`,
      );
      message.success(t('page.recategorized', { changed: result.changed, processed: result.processed }));
      setGroupsRefresh((key) => key + 1);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = () => {
    setWorkflowFilter(null);
    setDayFilter(null);
  };

  const filterLabel = [
    workflowFilter &&
      (stats?.workflows.find((w) => w.externalWorkflowId === workflowFilter)?.name ?? workflowFilter),
    dayFilter && t('page.filterDay', { day: dayFilter }),
  ]
    .filter(Boolean)
    .join(' · ');

  const empty = stats?.total === 0;

  return (
    <List
      title={t('page.title')}
      headerButtons={
        <Space>
          <Segmented
            options={PERIODS.map((value) => ({ value, label: t('page.periodDays', { days: value }) }))}
            value={days}
            onChange={(value) => {
              setDays(value as number);
              setDayFilter(null);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={loadStats} loading={loadingStats}>
            {tc('refresh')}
          </Button>
          <Dropdown
            trigger={['click']}
            disabled={busy}
            menu={{
              items: [
                {
                  key: 'backfill',
                  icon: <CloudDownloadOutlined />,
                  label: t('page.backfillMenu'),
                  onClick: () => setBackfillOpen(true),
                },
                ...(stats && stats.ungrouped > 0
                  ? [
                      {
                        key: 'regroup',
                        icon: <GroupOutlined />,
                        label: (
                          <Tooltip title={t('page.regroupTooltip')} placement="left">
                            {t('page.regroup', { count: stats.ungrouped })}
                          </Tooltip>
                        ),
                        onClick: runRegroup,
                      },
                    ]
                  : []),
                {
                  key: 'recategorize',
                  icon: <TagsOutlined />,
                  label: (
                    <Tooltip title={t('page.recategorizeTooltip')} placement="left">
                      {t('page.recategorize')}
                    </Tooltip>
                  ),
                  onClick: runRecategorize,
                },
              ],
            }}
          >
            <Button icon={<MoreOutlined />} loading={busy} aria-label={t('page.moreActions')} />
          </Dropdown>
        </Space>
      }
    >
      {statsError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('page.statsUnavailable')}
          description={statsError}
        />
      )}

      {empty && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('emptyPeriod')}>
          <Button icon={<CloudDownloadOutlined />} onClick={() => setBackfillOpen(true)}>
            {t('page.backfillMenu')}
          </Button>
        </Empty>
      )}

      {!empty && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} lg={16}>
              <Card size="small" title={t('page.whenBroke')} loading={loadingStats}>
                {stats && (
                  <>
                    <ErrorTimeline
                      stats={stats}
                      colors={colors}
                      selected={dayFilter}
                      onSelectDay={setDayFilter}
                    />
                    <Space wrap size={[12, 4]} style={{ marginTop: 8 }}>
                      {stats.workflows.slice(0, 10).map((workflow) => (
                        <Tag
                          key={workflow.externalWorkflowId}
                          color={
                            workflowFilter && workflowFilter !== workflow.externalWorkflowId
                              ? 'default'
                              : undefined
                          }
                          style={{
                            cursor: 'pointer',
                            borderLeft: `4px solid ${colors.get(workflow.externalWorkflowId) ?? OTHERS_COLOR}`,
                          }}
                          onClick={() =>
                            setWorkflowFilter(
                              workflowFilter === workflow.externalWorkflowId
                                ? null
                                : workflow.externalWorkflowId,
                            )
                          }
                        >
                          {t('page.workflowTag', { name: workflow.name, count: workflow.total })}
                        </Tag>
                      ))}
                    </Space>
                  </>
                )}
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card size="small" title={t('page.onPeriod')} loading={loadingStats}>
                {stats && (
                  <Row gutter={16}>
                    <Col span={8}>
                      <Statistic title={t('page.statErrors')} value={stats.total} />
                    </Col>
                    <Col span={8}>
                      <Tooltip title={t('page.statOpenTooltip')}>
                        <Statistic
                          title={t('page.statOpen')}
                          value={stats.openGroups}
                          valueStyle={stats.openGroups > 0 ? { color: BRAND.danger } : undefined}
                        />
                      </Tooltip>
                    </Col>
                    <Col span={8}>
                      <Statistic title={t('page.statWorkflows')} value={stats.workflows.length} />
                    </Col>
                    {stats.workflows[0] && (
                      <Col span={24} style={{ marginTop: 12 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('page.mostFragile', {
                            name: stats.workflows[0].name,
                            count: stats.workflows[0].total,
                          })}
                        </Typography.Text>
                      </Col>
                    )}
                  </Row>
                )}
              </Card>
            </Col>
          </Row>

          <Card size="small" title={t('page.whoBreaks')} style={{ marginBottom: 16 }} loading={loadingStats}>
            {stats && (
              <ErrorHeatmap
                stats={stats}
                selected={{ externalWorkflowId: workflowFilter, date: dayFilter }}
                onSelectCell={(workflowId, date) => {
                  setWorkflowFilter(workflowId);
                  setDayFilter(date);
                }}
              />
            )}
          </Card>

          <Space style={{ marginBottom: 12 }} wrap>
            <Segmented
              options={VIEWS.map((value) => ({ value, label: t(`page.views.${value}`) }))}
              value={view}
              onChange={(value) => setView(value as (typeof VIEWS)[number])}
            />
            <Input.Search
              placeholder={t('page.searchPlaceholder')}
              allowClear
              style={{ width: 320 }}
              defaultValue={search}
              onSearch={setSearch}
            />
            {filterLabel && (
              <Tag closable onClose={clearFilters} color="blue">
                {t('page.filtered', { label: filterLabel })}
              </Tag>
            )}
          </Space>

          {view === 'groups' && (
            <ErrorGroupsTable
              filters={{
                instanceId: scope ?? undefined,
                externalWorkflowId: workflowFilter ?? undefined,
                days,
                from: dayFilter ? dayStart(dayFilter, 0) : undefined,
                to: dayFilter ? dayStart(dayFilter, 1) : undefined,
                q: search,
              }}
              instanceName={instanceName}
              showInstance={!scope}
              onOpen={setSelectedGroup}
              refreshKey={groupsRefresh}
            />
          )}

          {/* rc-table pose `width: auto` sur la table : sans ça, la colonne Message
          s'étire à la largeur du texte au lieu d'être coupée par l'ellipsis. */}
          {view === 'occurrences' && (
            <Table
              {...tableProps}
              className="errors-table"
              rowKey="id"
              size="small"
              tableLayout="fixed"
              onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: 'pointer' } })}
              locale={{
                emptyText: <Empty description={t('page.noError')} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
              }}
            >
              <Table.Column
                dataIndex="startedAt"
                title={t('page.when')}
                sorter
                width={170}
                render={(value: string) => new Date(value).toLocaleString(locale)}
              />
              <Table.Column
                dataIndex="workflowName"
                title={tc('columns.workflow')}
                sorter
                width={220}
                ellipsis
              />
              {!scope && (
                <Table.Column<ExecutionErrorRow>
                  title={tc('columns.instance')}
                  width={140}
                  render={(_, record) => <Tag color="blue">{instanceName(record.instanceId)}</Tag>}
                />
              )}
              <Table.Column<ExecutionErrorRow>
                dataIndex="failedNode"
                title={t('page.failedNode')}
                width={180}
                render={(node: string | null, record) =>
                  node ? (
                    <Tooltip title={record.failedNodeType}>
                      <Tag color="red">{node}</Tag>
                    </Tooltip>
                  ) : record.detailState === 'pending' ? (
                    <Typography.Text type="secondary">{t('page.toFetch')}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  )
                }
              />
              <Table.Column
                dataIndex="message"
                title={tc('columns.message')}
                ellipsis
                render={(value: string | null) =>
                  value ? (
                    // Coupé avant le rendu : un message n8n fait parfois plusieurs milliers de
                    // caractères et étirerait la colonne malgré l'ellipsis.
                    <Tooltip title={value}>{value.length > 160 ? `${value.slice(0, 159)}…` : value}</Tooltip>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  )
                }
              />
              <Table.Column<ExecutionErrorRow>
                title=""
                width={48}
                render={(_, record) =>
                  record.n8nUrl && (
                    <Tooltip title={t('page.openExecution')}>
                      <Button
                        size="small"
                        type="text"
                        icon={<ExportOutlined />}
                        href={record.n8nUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Tooltip>
                  )
                }
              />
            </Table>
          )}
        </>
      )}

      <ErrorDetailDrawer row={selected} onClose={() => setSelected(null)} />

      <ErrorGroupDrawer
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
        onChanged={() => {
          setGroupsRefresh((key) => key + 1);
          loadStats();
        }}
      />

      <Modal
        title={t('page.backfillTitle')}
        open={backfillOpen}
        onCancel={() => setBackfillOpen(false)}
        onOk={runBackfill}
        okText={t('page.backfillOk', { days })}
        confirmLoading={busy}
      >
        <Select
          placeholder={t('page.backfillInstance')}
          style={{ width: '100%' }}
          options={instances.map((instance) => ({ label: instance.name, value: instance.id }))}
          value={backfillInstance}
          onChange={setBackfillInstance}
        />
      </Modal>
    </List>
  );
}

/**
 * Bornes d'un jour du graphe, en instant absolu : le découpage des buckets est fait
 * dans le fuseau d'affichage, l'envoyer en ISO évite un décalage d'une ou deux heures.
 */
function dayStart(date: string, offsetDays: number): string {
  const start = new Date(`${date}T00:00:00`);
  start.setDate(start.getDate() + offsetDays);
  return start.toISOString();
}
