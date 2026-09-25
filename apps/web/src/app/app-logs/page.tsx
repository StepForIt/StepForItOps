'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List } from '@refinedev/antd';
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
      message.success(`${lines} ligne(s) téléchargée(s)`);
    } catch (caught) {
      message.error((caught as Error).message);
    }
  };

  const clear = async () => {
    try {
      await apiDelete('/app-logs');
      lastSeq.current = undefined;
      setEntries([]);
      message.success('Tampon vidé');
    } catch (caught) {
      message.error((caught as Error).message);
    }
  };

  const contextOptions = useMemo(() => contexts.map((name) => ({ label: name, value: name })), [contexts]);

  return (
    <List
      title="Logs de la plateforme"
      headerButtons={
        <ActionBar
          primary={
            <Space size={4}>
              <Switch checked={follow} onChange={setFollow} size="small" />
              <Typography.Text type="secondary">Suivre</Typography.Text>
            </Space>
          }
          actions={[
            {
              key: 'reload',
              label: 'Rafraîchir',
              icon: <ReloadOutlined />,
              loading,
              onClick: () => void load(true),
            },
            {
              key: 'download',
              label: 'Télécharger',
              icon: <DownloadOutlined />,
              onClick: () => void download(),
            },
            {
              key: 'clear',
              label: 'Vider',
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
        title="Vider le tampon ?"
        okText="Vider"
        okButtonProps={{ danger: true }}
        cancelText="Annuler"
        onCancel={() => setClearOpen(false)}
        onOk={() => {
          setClearOpen(false);
          void clear();
        }}
      >
        Les lignes affichées ici disparaissent. La sortie du conteneur, elle, garde tout.
      </Modal>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Les dernières lignes de l'API, gardées en mémoire du process"
        description={
          <>
            Un redémarrage de l&apos;api les efface, et chaque process ne voit que les siennes. Pour
            l&apos;historique complet, la sortie du conteneur reste la source :{' '}
            <Typography.Text code>docker compose logs -f api</Typography.Text>. Les secrets reconnaissables
            (clés d&apos;API, jetons) sont masqués avant affichage.
          </>
        }
      />

      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} closable />}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size="middle">
          <Checkbox.Group
            value={levels}
            onChange={(next) => setLevels(next as AppLogLevel[])}
            options={LEVELS.map((level) => ({ label: level.label, value: level.value }))}
          />
          <Select
            allowClear
            placeholder="Tous les contextes"
            style={{ minWidth: 220 }}
            value={context}
            onChange={setContext}
            options={contextOptions}
            showSearch
          />
          <Input.Search
            allowClear
            placeholder="Chercher (message, contexte, pile)"
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
        {entries.length} ligne(s) affichée(s)
        {buffer ? ` · tampon : ${buffer.held}/${buffer.capacity}` : ''}
        {buffer?.dropped ? ` · ${buffer.dropped} ligne(s) déjà sorties du tampon` : ''}
      </Typography.Text>
    </List>
  );
}
