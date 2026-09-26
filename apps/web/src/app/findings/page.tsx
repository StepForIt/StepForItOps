'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Input, Select, Space, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { ExportOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';
import { runWithConcurrency } from '../../lib/concurrency';
import { useInstanceScope } from '../../lib/instance-scope';
import { RenameSuggestionsModal } from '../../components/rename-suggestions-modal';
import { StickySuggestionsModal } from '../../components/sticky-suggestions-modal';
import { DisplayFinding, FindingsList } from '../../components/findings-list';
import { useEnvColor, useEnvOptions } from '../../lib/envs';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { useIsMobile } from '../../components/mobile/use-is-mobile';
import { MobileFilterBar } from '../../components/mobile/mobile-filter-bar';
import { ResponsiveCard } from '../../components/mobile/responsive-card';

interface Summary {
  workflowId: string;
  instanceId: string;
  name: string;
  env: string | null;
  active: boolean;
  n8nUrl: string;
  counts: { error: number; warning: number; info: number };
  byModule: Record<string, number>;
  lastCheckAt: string | null;
}

interface Finding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName?: string | null;
  /** Détail libre de la règle : correctif proposé et position dans le code du nœud. */
  data?: {
    suggestion?: string;
    line?: number;
    snippet?: string;
    snippetStart?: number;
    autoFix?: boolean;
  } | null;
}

/** Workflows analysés de front lors d'un « Tout vérifier ». */
const MASS_RUN_CONCURRENCY = 4;

/** Aplatit `data` : la liste ne connaît que des champs, pas la forme libre de la règle. */
function toDisplay(finding: Finding): DisplayFinding {
  return {
    id: finding.id,
    module: finding.module,
    severity: finding.severity,
    code: finding.code,
    message: finding.message,
    nodeName: finding.nodeName,
    suggestion: finding.data?.suggestion ?? null,
    line: finding.data?.line ?? null,
    snippet: finding.data?.snippet ?? null,
    snippetStart: finding.data?.snippetStart ?? null,
    autoFix: finding.data?.autoFix === true,
  };
}

function FindingsDetail({
  workflowId,
  version,
  severities,
  moduleFilter,
  onChanged,
}: {
  workflowId: string;
  version: number;
  severities: string[];
  moduleFilter?: string;
  /** Prévient la liste parente (compteurs de la couverture) après un « Ignorer ». */
  onChanged: () => void;
}) {
  const t = useTranslations('inventory.findings.detail');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [stickyOpen, setStickyOpen] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoadError(null);
    // Sans branche d'erreur, un échec laissait la liste PRÉCÉDENTE à l'écran :
    // on lisait les findings d'un autre workflow, ou ceux d'avant l'analyse,
    // en croyant lire les siens.
    apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`)
      .then((rows) => current && setFindings(rows))
      .catch((error: unknown) => {
        if (!current) return;
        setFindings([]);
        setLoadError((error as Error).message);
      });
    return () => {
      current = false;
    };
  }, [workflowId, version, localVersion]);

  /** Après application (renommage ou stickies) : relance l'analyse optimizer puis recharge. */
  const afterApply = async () => {
    // L'échec était avalé : la liste se rechargeait à l'identique et l'on
    // attribuait à l'analyse un silence qui venait de l'appel.
    await apiPost(`/optimizer/analyze/${workflowId}`).catch((error: unknown) =>
      message.error(t('reanalyseFailed', { error: (error as Error).message })),
    );
    setLocalVersion((v) => v + 1);
  };

  const hasDefaultNames = findings.some((f) => f.module === 'optimizer' && f.code === 'default-name');
  const hasStickyIssues = findings.some((f) => f.module === 'optimizer' && f.code.startsWith('sticky-'));

  const visible = findings.filter(
    (f) =>
      (severities.length === 0 || severities.includes(f.severity)) &&
      (!moduleFilter || f.module === moduleFilter),
  );
  const hidden = findings.length - visible.length;

  return (
    <>
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('loadFailed')}
          description={loadError}
          action={
            <Button size="small" onClick={() => setLocalVersion((v) => v + 1)}>
              {t('retry')}
            </Button>
          }
        />
      )}
      <FindingsList
        findings={visible.map(toDisplay)}
        onChanged={() => {
          setLocalVersion((v) => v + 1);
          onChanged();
        }}
        emptyText={
          loadError ? t('emptyLoadFailed') : findings.length === 0 ? t('emptyNone') : t('emptyFiltered')
        }
        actions={
          <>
            {hasDefaultNames && (
              <Button size="small" onClick={() => setRenameOpen(true)}>
                {t('renameNodes')}
              </Button>
            )}
            {hasStickyIssues && (
              <Button size="small" onClick={() => setStickyOpen(true)}>
                {t('documentZones')}
              </Button>
            )}
          </>
        }
      />
      {hidden > 0 && <p style={{ marginTop: 8, color: '#999' }}>{t('hidden', { count: hidden })}</p>}
      <RenameSuggestionsModal
        workflowId={workflowId}
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        onApplied={afterApply}
      />
      <StickySuggestionsModal
        workflowId={workflowId}
        open={stickyOpen}
        onClose={() => setStickyOpen(false)}
        onApplied={afterApply}
      />
    </>
  );
}

export default function FindingsCoverage() {
  const t = useTranslations('inventory.findings.page');
  const locale = useLocale();
  const envColor = useEnvColor();
  const envOptions = useEnvOptions();
  const { scope, instanceName } = useInstanceScope();
  const [rows, setRows] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const mobile = useIsMobile();
  const [search, setSearch] = usePersistedState('search', '');
  const [onlyWithFindings, setOnlyWithFindings] = usePersistedState('onlyWithFindings', false);
  const [severities, setSeverities] = usePersistedState<string[]>('severities', []);
  const [moduleFilter, setModuleFilter] = usePersistedState<string | undefined>('module', undefined);
  const [envFilter, setEnvFilter] = usePersistedState<string | undefined>('env', undefined);
  const [busyRows, setBusyRows] = useState<string[]>([]);
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [version, setVersion] = useState(0); // force le refresh des détails dépliés

  const fetchRows = useCallback(
    () => apiGet<Summary[]>(scope ? `/findings/summary?instanceId=${scope}` : '/findings/summary'),
    [scope],
  );

  const load = useCallback(() => {
    setLoading(true);
    fetchRows()
      .then(setRows)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [fetchRows]);

  useEffect(load, [load]);

  /**
   * Rafraîchissement silencieux après chaque workflow d'un run de masse. Le compteur départage
   * les réponses qui se croisent — une réponse en retard ne doit pas écraser une plus fraîche.
   */
  const refreshSeq = useRef(0);
  const refreshQuietly = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const fresh = await fetchRows().catch(() => null);
    if (!fresh || seq !== refreshSeq.current) return;
    setRows(fresh);
    setVersion((v) => v + 1); // les lignes dépliées se rechargent aussi
  }, [fetchRows]);

  /**
   * Lance les 4 analyses d'un workflow. Renvoie aussi le détail des échecs (module désactivé
   * = 404, session expirée, API injoignable) : sans lui, une analyse cassée passait inaperçue.
   */
  const runModules = async (workflowId: string): Promise<{ ok: number; errors: string[] }> => {
    const results = await Promise.allSettled([
      apiPost(`/verifier/run/${workflowId}?ai=1`),
      apiPost(`/js-checker/run/${workflowId}?ai=1`),
      apiPost(`/optimizer/analyze/${workflowId}`),
      apiPost(`/field-checker/run/${workflowId}`),
    ]);
    return {
      ok: results.filter((r) => r.status === 'fulfilled').length,
      errors: results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as Error)?.message ?? String(r.reason)),
    };
  };

  const runAll = async (workflowId: string) => {
    setBusyRows([workflowId]);
    try {
      const { ok, errors } = await runModules(workflowId);
      if (errors.length > 0) message.warning(t('runPartial', { ok, error: errors[0] }));
      else message.success(t('runDone'));
      load();
      setVersion((v) => v + 1);
    } finally {
      setBusyRows([]);
    }
  };

  /** Vérifie tous les workflows affichés, par paquets : le temps se passe à attendre le modèle. */
  const runAllWorkflows = async (targets: Summary[]) => {
    setAllProgress({ done: 0, total: targets.length });
    const failures: string[] = [];
    try {
      await runWithConcurrency(
        targets,
        MASS_RUN_CONCURRENCY,
        async (row) => {
          setBusyRows((rows) => [...rows, row.workflowId]);
          try {
            const { errors } = await runModules(row.workflowId);
            failures.push(...errors.map((error) => `${row.name} — ${error}`));
          } finally {
            setBusyRows((rows) => rows.filter((id) => id !== row.workflowId));
            await refreshQuietly();
          }
        },
        () => setAllProgress((p) => (p ? { ...p, done: p.done + 1 } : p)),
      );
      if (failures.length > 0) {
        message.warning(
          t('massPartial', { total: targets.length, failed: failures.length, example: failures[0] }),
          10,
        );
        // eslint-disable-next-line no-console
        console.warn(`Analyses en échec (${failures.length}) :\n${failures.join('\n')}`);
      } else {
        message.success(t('massDone', { total: targets.length }));
      }
      // Pas de `load()` final : le dernier workflow terminé a déjà rafraîchi la liste.
    } finally {
      setBusyRows([]);
      setAllProgress(null);
    }
  };

  // Modules connus (au moins un run enregistré), pour alimenter le filtre par module.
  const moduleOptions = Array.from(new Set(rows.flatMap((row) => Object.keys(row.byModule))))
    .sort()
    .map((m) => ({ value: m, label: m }));

  const filtered = rows.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyWithFindings && row.counts.error + row.counts.warning + row.counts.info === 0) return false;
    if (severities.length > 0 && !severities.some((s) => row.counts[s as keyof Summary['counts']] > 0)) {
      return false;
    }
    if (moduleFilter && !(row.byModule[moduleFilter] > 0)) return false;
    if (envFilter && (envFilter === 'unknown' ? row.env !== null : row.env !== envFilter)) return false;
    return true;
  });

  const actions = (
    <Space wrap>
      <Tooltip title={t('runAllHint')}>
        <Button
          type="primary"
          loading={allProgress !== null}
          disabled={filtered.length === 0}
          onClick={() => runAllWorkflows(filtered)}
        >
          {allProgress
            ? t('runAllProgress', { done: allProgress.done, total: allProgress.total })
            : t('runAll', { count: filtered.length })}
        </Button>
      </Tooltip>
      <Button onClick={load}>{t('refresh')}</Button>
    </Space>
  );
  const width = (desktop: number) => (mobile ? '100%' : desktop);
  const filterControls = (
    <>
      <Select
        mode="multiple"
        allowClear
        placeholder={t('severity')}
        style={{ minWidth: width(180) }}
        value={severities}
        onChange={setSeverities}
        options={[
          { value: 'error', label: <Tag color="red">error</Tag> },
          { value: 'warning', label: <Tag color="orange">warning</Tag> },
          { value: 'info', label: <Tag color="blue">info</Tag> },
        ]}
      />
      <Select
        allowClear
        placeholder={t('moduleFilter')}
        style={{ minWidth: width(200) }}
        value={moduleFilter}
        onChange={setModuleFilter}
        options={moduleOptions}
      />
      <Select
        allowClear
        placeholder={t('env')}
        style={{ minWidth: width(120) }}
        value={envFilter}
        onChange={setEnvFilter}
        options={[...envOptions, { value: 'unknown', label: t('unknownEnv') }]}
      />
      <Space>
        <Switch checked={onlyWithFindings} onChange={setOnlyWithFindings} />
        <span>{t('onlyWithFindings')}</span>
      </Space>
    </>
  );

  return (
    <ResponsiveCard title={t('title')} extra={actions}>
      {mobile ? (
        <>
          <MobileFilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder={t('searchPlaceholder')}
            activeCount={
              [severities.length > 0, moduleFilter, envFilter, onlyWithFindings].filter(Boolean).length
            }
            onReset={() => {
              setSeverities([]);
              setModuleFilter(undefined);
              setEnvFilter(undefined);
              setOnlyWithFindings(false);
            }}
          >
            {filterControls}
          </MobileFilterBar>
        </>
      ) : (
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder={t('searchPlaceholder')}
            allowClear
            style={{ width: 280 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filterControls}
        </Space>
      )}
      <Table
        dataSource={filtered}
        mobileLayout={{ badges: ['env'] }}
        rowKey="workflowId"
        loading={loading}
        expandable={{
          expandedRowRender: (record) => (
            <FindingsDetail
              workflowId={record.workflowId}
              version={version}
              severities={severities}
              moduleFilter={moduleFilter}
              onChanged={load}
            />
          ),
        }}
      >
        <Table.Column<Summary>
          dataIndex="name"
          title={t('columns.workflow')}
          render={(name: string, record) => (
            <Space size={4}>
              <Link href={`/workflows/show/${record.workflowId}`}>{name}</Link>
              <Tooltip title={t('openInN8n')}>
                <a href={record.n8nUrl} target="_blank" rel="noopener noreferrer">
                  <ExportOutlined />
                </a>
              </Tooltip>
            </Space>
          )}
        />
        {!scope && (
          <Table.Column<Summary>
            dataIndex="instanceId"
            title={t('columns.instance')}
            render={(id: string) => <Tag color="blue">{instanceName(id)}</Tag>}
          />
        )}
        <Table.Column<Summary>
          dataIndex="env"
          title={t('columns.env')}
          render={(env: string | null) => (env ? <Tag color={envColor(env)}>{env}</Tag> : <Tag>?</Tag>)}
        />
        <Table.Column<Summary>
          title={t('columns.findings')}
          render={(_, record) => (
            <Space>
              <Badge count={record.counts.error} color="red" showZero={false} />
              <Badge count={record.counts.warning} color="orange" showZero={false} />
              <Badge count={record.counts.info} color="blue" showZero={false} />
              {record.counts.error + record.counts.warning + record.counts.info === 0 && (
                <Typography.Text type="secondary">—</Typography.Text>
              )}
            </Space>
          )}
        />
        <Table.Column<Summary>
          dataIndex="byModule"
          title={t('columns.modules')}
          render={(byModule: Record<string, number>) => {
            const entries = Object.entries(byModule);
            if (entries.length === 0)
              return <Typography.Text type="secondary">{t('neverAnalysed')}</Typography.Text>;
            const clean = entries.filter(([, count]) => count === 0).length;
            return (
              <Space size={4} wrap>
                {entries
                  .filter(([, count]) => count > 0)
                  .map(([m, count]) => (
                    <Tag key={m}>{t('moduleCount', { module: m, count })}</Tag>
                  ))}
                {clean > 0 && (
                  <Typography.Text type="secondary">{t('modulesOk', { count: clean })}</Typography.Text>
                )}
              </Space>
            );
          }}
        />
        <Table.Column<Summary>
          dataIndex="lastCheckAt"
          title={t('columns.lastCheck')}
          render={(d: string | null) => (d ? new Date(d).toLocaleString(locale) : '—')}
        />
        <Table.Column<Summary>
          title=""
          render={(_, record) => (
            <Tooltip title={t('runHint')}>
              <Button
                size="small"
                type="primary"
                loading={busyRows.includes(record.workflowId)}
                disabled={allProgress !== null && !busyRows.includes(record.workflowId)}
                onClick={() => runAll(record.workflowId)}
              >
                {t('run')}
              </Button>
            </Tooltip>
          )}
        />
      </Table>
    </ResponsiveCard>
  );
}
