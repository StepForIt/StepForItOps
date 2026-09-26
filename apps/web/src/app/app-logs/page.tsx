'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List } from '@refinedev/antd';
import { useTranslations } from 'next-intl';
import { Alert, Card, Checkbox, Input, Modal, Select, Space, Switch, Typography, message } from 'antd';
import { ClearOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiDelete, apiGet } from '../../lib/api';
import { LogConsole } from './log-console';
import { ActionBar } from '../../components/action-bar';
import { AppLogEntry, AppLogLevel, AppLogsResponse, DEFAULT_LEVELS, LEVELS } from './types';

/** Cadence du suivi : assez vif pour un `-f`, assez lâche pour ne pas marteler l'API. */
const REFRESH_MS = 2_000;
/** Lignes gardées à l'écran ; le tampon de l'api en tient davantage. */
const WINDOW = 500;

function queryString(
  levels: AppLogLevel[],
  context: string | undefined,
  search: string,
  sinceSeq?: number,
): string {
  const params = new URLSearchParams({ limit: String(WINDOW) });
  if (levels.length && levels.length < LEVELS.length) params.set('levels', levels.join(','));
  if (context) params.set('context', context);
  if (search.trim()) params.set('search', search.trim());
  if (sinceSeq !== undefined) params.set('sinceSeq', String(sinceSeq));
  return params.toString();
}

/**
 * Page « Logs » : les dernières lignes de l'API, sans passer par le serveur.
 *
 * Le rafraîchissement est INCRÉMENTAL (`sinceSeq`) : redemander 500 lignes
 * toutes les deux secondes pour en afficher une nouvelle ferait un aller-retour
 * de plusieurs centaines de ko par tick, et rejouerait le rendu du journal entier.
 */
export default function AppLogsPage() {
  const t = useTranslations('misc.appLogs');
  const tc = useTranslations('common');
  const [levels, setLevels] = useState<AppLogLevel[]>(DEFAULT_LEVELS);
  const [context, setContext] = useState<string>();
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);

  const [entries, setEntries] = useState<AppLogEntry[]>([]);
  const [contexts, setContexts] = useState<string[]>([]);
  const [buffer, setBuffer] = useState<{ held: number; capacity: number; dropped: number }>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // Curseur hors du state : le tick d'intervalle capture les valeurs du rendu où
  // il a été armé, et repartirait indéfiniment du même rang.
  const lastSeq = useRef<number>();

  const load = useCallback(
    async (incremental: boolean) => {
      try {
        const since = incremental ? lastSeq.current : undefined;
        const page = await apiGet<AppLogsResponse>(
          `/app-logs?${queryString(levels, context, search, since)}`,
        );
        lastSeq.current = page.lastSeq;
        setContexts(page.contexts);
        setBuffer({ held: page.held, capacity: page.capacity, dropped: page.dropped });
        setEntries((current) => (incremental ? [...current, ...page.entries].slice(-WINDOW) : page.entries));
        setError(undefined);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [levels, context, search],
  );

  // Filtres changés : on repart de zéro, le curseur ne vaut plus rien puisqu'il
  // désigne un rang atteint sous d'autres critères.
  useEffect(() => {
    lastSeq.current = undefined;
    setLoading(true);
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!follow) return undefined;
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [follow, load]);

  const download = async () => {
    try {
      const { text, lines } = await apiGet<{ text: string; lines: number }>(
        `/app-logs/export?${queryString(levels, context, search)}`,
      );
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(t('downloaded', { count: lines }));
    } catch (caught) {
      message.error((caught as Error).message);
    }
  };

  const clear = async () => {
    try {
      await apiDelete('/app-logs');
      lastSeq.current = undefined;
      setEntries([]);
      message.success(t('cleared'));
    } catch (caught) {
      message.error((caught as Error).message);
    }
  };

  const contextOptions = useMemo(() => contexts.map((name) => ({ label: name, value: name })), [contexts]);

  return (
    <List
      title={t('title')}
      headerButtons={
        <ActionBar
          primary={
            <Space size={4}>
              <Switch checked={follow} onChange={setFollow} size="small" />
              <Typography.Text type="secondary">{t('follow')}</Typography.Text>
            </Space>
          }
          actions={[
            {
              key: 'reload',
              label: tc('refresh'),
              icon: <ReloadOutlined />,
              loading,
              onClick: () => void load(true),
            },
            {
              key: 'download',
              label: tc('download'),
              icon: <DownloadOutlined />,
              onClick: () => void download(),
            },
            {
              key: 'clear',
              label: t('clear'),
              icon: <ClearOutlined />,
              danger: true,
              onClick: () => setClearOpen(true),
            },
          ]}
        />
      }
    >
      <Modal
        open={clearOpen}
        title={t('clearModal.title')}
        okText={t('clear')}
        okButtonProps={{ danger: true }}
        cancelText={tc('cancel')}
        onCancel={() => setClearOpen(false)}
        onOk={() => {
          setClearOpen(false);
          void clear();
        }}
      >
        {t('clearModal.body')}
      </Modal>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('info.title')}
        description={t.rich('info.body', {
          code: (chunks) => <Typography.Text code>{chunks}</Typography.Text>,
        })}
      />

      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} closable />}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size="middle">
          <Checkbox.Group
            value={levels}
            onChange={(next) => setLevels(next as AppLogLevel[])}
            options={LEVELS.map((level) => ({ label: t(`levels.${level.value}`), value: level.value }))}
          />
          <Select
            allowClear
            placeholder={t('allContexts')}
            style={{ minWidth: 220 }}
            value={context}
            onChange={setContext}
            options={contextOptions}
            showSearch
          />
          <Input.Search
            allowClear
            placeholder={t('searchPlaceholder')}
            style={{ width: 300 }}
            onSearch={setSearch}
            onChange={(event) => {
              if (!event.target.value) setSearch('');
            }}
          />
        </Space>
      </Card>

      <LogConsole entries={entries} />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('shown', { count: entries.length })}
        {buffer ? t('buffer', { held: buffer.held, capacity: buffer.capacity }) : ''}
        {buffer?.dropped ? t('dropped', { count: buffer.dropped }) : ''}
      </Typography.Text>
    </List>
  );
}
