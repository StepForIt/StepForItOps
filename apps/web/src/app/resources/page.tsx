'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Table } from '../../components/resizable-table';
import { EditOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../lib/api';
import { useIsMobile } from '../../components/mobile/use-is-mobile';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { NocoDbNamesModal } from './nocodb-names-modal';
import { ColumnImpact, ResourceCall, ResourceNodeUsage, ResourceSummary, ResourceUsageResult } from './types';

const IMPACT_ORDER: Record<ColumnImpact, number> = { 'to-update': 0, unknown: 1, 'no-action': 2 };

const IMPACT_META: Record<ColumnImpact, { label: string; color: string }> = {
  'to-update': { label: 'À modifier', color: 'red' },
  unknown: { label: 'À vérifier', color: 'orange' },
  'no-action': { label: 'Sans action', color: 'green' },
};

/** Même liste que `resource-label.ts` côté API, pour l'en-tête des groupes. */
const PROVIDER_LABELS: Record<string, string> = {
  airtable: 'Airtable',
  'google-sheets': 'Google Sheets',
  notion: 'Notion',
  nocodb: 'NocoDB',
  postgres: 'PostgreSQL',
  http: 'API',
};

const ACCESS_META: Record<string, { label: string; color: string }> = {
  read: { label: 'lecture', color: 'blue' },
  write: { label: 'écriture', color: 'purple' },
  delete: { label: 'suppression', color: 'default' },
  other: { label: 'autre', color: 'default' },
};

/** Sans colonne saisie, on classe quand même : liste figée = nœud à connaître. */
function impactOf(usage: ResourceNodeUsage): ColumnImpact {
  if (usage.impact) return usage.impact;
  if (!usage.understood) return 'unknown';
  return usage.fields && usage.fields.length > 0 ? 'to-update' : 'no-action';
}

/**
 * Même règle que `matchesResourceQuery` du domaine (le web ne dépend pas de `@nwm/core`) :
 * chaque mot saisi doit se retrouver dans un des termes, les mots se cumulent.
 */
function matches(terms: string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => terms.some((term) => term.includes(word)));
}

/** Une entrée du sélecteur : `terms` porte tout ce sous quoi elle peut être trouvée. */
interface ResourceOption {
  value: string;
  label: string;
  terms: string[];
}

/** Ressource et colonne vivent dans l'URL : la page se garde en favori et se partage. */
function readUrl(): { key?: string; column: string } {
  if (typeof window === 'undefined') return { column: '' };
  const params = new URLSearchParams(window.location.search);
  return { key: params.get('key') ?? undefined, column: params.get('column') ?? '' };
}

function writeUrl(key: string | undefined, column: string): void {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  if (column.trim()) params.set('column', column.trim());
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

export default function ResourcesPage() {
  const mobile = useIsMobile();
  const { scope } = useInstanceScope();
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const initial = useMemo(readUrl, []);
  const [resourceKey, setResourceKey] = useState<string | undefined>(initial.key);
  const [column, setColumn] = useState(initial.column);
  const [result, setResult] = useState<ResourceUsageResult | null>(null);
  const [filter, setFilter] = usePersistedState<'tout' | ColumnImpact>('impact', 'tout', {
    validate: (value) =>
      value === 'tout' || value === 'to-update' || value === 'no-action' || value === 'unknown'
        ? value
        : undefined,
  });
  const [busy, setBusy] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<ResourceSummary | null>(null);
  const [newLabel, setNewLabel] = useState('');
  // Prod seule par défaut, comme la carte : les exemplaires dev et preprod d'un
  // même workflow métier faisaient compter deux ou trois fois le même usage.
  const [includeOtherEnvs, setIncludeOtherEnvs] = usePersistedState('includeOtherEnvs', false);

  const loadResources = useCallback(() => {
    const params = new URLSearchParams();
    if (scope) params.set('instanceId', scope);
    if (includeOtherEnvs) params.set('includeOtherEnvs', '1');
    apiGet<ResourceSummary[]>(`/dep-graph/resources?${params}`)
      .then(setResources)
      .catch((error: Error) => message.error(error.message));
  }, [scope, includeOtherEnvs]);

  // Scope connu dès le premier rendu (InstanceScopeGate) : premier chargement déjà filtré.
  // Comparé au scope précédent, et non à un « premier rendu » : en StrictMode
  // l'effet se rejoue au montage et viderait la sélection venue de l'URL.
  const previousScope = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    loadResources();
    // Changer d'instance vide la sélection : la ressource n'y existe peut-être pas.
    if (previousScope.current !== undefined && previousScope.current !== scope) setResourceKey(undefined);
    previousScope.current = scope;
  }, [scope, loadResources]);

  useEffect(() => {
    writeUrl(resourceKey, column);
    if (!resourceKey) {
      setResult(null);
      return;
    }
    const params = new URLSearchParams({ key: resourceKey });
    if (column.trim()) params.set('column', column.trim());
    if (scope) params.set('instanceId', scope);
    if (includeOtherEnvs) params.set('includeOtherEnvs', '1');
    setBusy(true);
    apiGet<ResourceUsageResult>(`/dep-graph/resources/usage?${params}`)
      .then(setResult)
      .catch((error: Error) => message.error(error.message))
      .finally(() => setBusy(false));
  }, [resourceKey, column, scope, includeOtherEnvs]);

  const selected = resources.find((resource) => resource.key === resourceKey);
  const isApi = (result?.resource?.kind ?? selected?.kind) === 'api';

  /**
   * Sélecteur groupé par contenant. Filtrage fait ici et non par antd : `filterOption`
   * s'applique au groupe, qui ne porte pas les termes de recherche de ses tables.
   */
  const options = useMemo(() => {
    const groups = new Map<string, { label: string; options: ResourceOption[] }>();
    for (const resource of resources.filter((row) => matches(row.terms, search))) {
      const group = groups.get(resource.containerKey) ?? {
        label: `${PROVIDER_LABELS[resource.provider] ?? resource.provider} · ${resource.containerLabel}`,
        options: [],
      };
      // Le groupe porte déjà système et contenant : l'entrée ne répète que ce qui la distingue.
      const item = resource.itemLabel ?? resource.key.split('/').slice(1).join('/');
      group.options.push({
        value: resource.key,
        terms: resource.terms,
        label: `${item || resource.label} — ${resource.nodeCount} nœuds · ${resource.workflowCount} workflows`,
      });
      groups.set(resource.containerKey, group);
    }
    return [...groups.values()];
  }, [resources, search]);

  const usages = useMemo(() => {
    const rows = result?.usages ?? [];
    const sorted = [...rows].sort(
      (a, b) =>
        IMPACT_ORDER[impactOf(a)] - IMPACT_ORDER[impactOf(b)] ||
        a.workflowName.localeCompare(b.workflowName) ||
        a.nodeName.localeCompare(b.nodeName),
    );
    return filter === 'tout' ? sorted : sorted.filter((usage) => impactOf(usage) === filter);
  }, [result, filter]);

  const counts = useMemo(() => {
    const tally: Record<ColumnImpact, number> = { 'to-update': 0, unknown: 0, 'no-action': 0 };
    for (const usage of result?.usages ?? []) tally[impactOf(usage)] += 1;
    return tally;
  }, [result]);

  /** Combien de nœuds tapent chaque route : l'hôte seul ne dit pas ce qu'on appelle. */
  const routes = useMemo(() => {
    const tally = new Map<string, number>();
    for (const call of result?.calls ?? []) {
      if (!call.url) continue;
      tally.set(call.url, (tally.get(call.url) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  const alreadyThere =
    column.trim().length > 0 &&
    (result?.knownColumns ?? []).some((known) => known.toLowerCase() === column.trim().toLowerCase());

  const submitRename = async () => {
    if (!renaming) return;
    try {
      await apiPost('/dep-graph/alias', { key: renaming.key, label: newLabel });
      message.success(newLabel.trim() ? 'Nom mis à jour' : 'Nom retiré');
      setRenaming(null);
      loadResources();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const usageColumns = [
    {
      title: 'Impact',
      key: 'impact',
      width: 180,
      render: (_: unknown, usage: ResourceNodeUsage) => {
        const meta = IMPACT_META[impactOf(usage)];
        const matching = usage.matchingColumns?.length
          ? `Rapprochement sur ${usage.matchingColumns.join(', ')}`
          : undefined;
        return (
          <Space direction="vertical" size={0}>
            <Tooltip title={[usage.impactReason, matching].filter(Boolean).join(' · ') || undefined}>
              {impactOf(usage) === 'no-action' ? (
                <Typography.Text type="secondary">{meta.label}</Typography.Text>
              ) : (
                <Tag color={meta.color}>{meta.label}</Tag>
              )}
            </Tooltip>
            {usage.requiredNotMapped.length > 0 && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                obligatoire non mappé : {usage.requiredNotMapped.join(', ')}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Workflow',
      key: 'workflow',
      render: (_: unknown, usage: ResourceNodeUsage) => (
        <Link href={`/workflows/show/${usage.workflowId}?tab=graph`}>{usage.workflowName}</Link>
      ),
    },
    {
      title: 'Nœud',
      key: 'node',
      render: (_: unknown, usage: ResourceNodeUsage) => (
        <Space size={4} wrap>
          <span>{usage.nodeName}</span>
          {usage.disabled && <Tag>désactivé</Tag>}
          {usage.dynamicTable && (
            <Tooltip title="La table est désignée par une expression : ce nœud vise peut-être une autre table à l'exécution.">
              <Tag color="orange">table dynamique</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Sens',
      key: 'access',
      width: 150,
      render: (_: unknown, usage: ResourceNodeUsage) => {
        const meta = ACCESS_META[usage.access] ?? ACCESS_META.other;
        return (
          <Space size={4}>
            <Tag color={meta.color}>{meta.label}</Tag>
            <Typography.Text type="secondary">{usage.operation || '—'}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'Champs figés',
      key: 'fields',
      width: 140,
      render: (_: unknown, usage: ResourceNodeUsage) =>
        usage.fields ? (
          <Tooltip title={usage.fields.join(', ')}>
            <Typography.Text underline>
              {usage.fields.length} champ{usage.fields.length > 1 ? 's' : ''}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ];

  const callColumns = [
    {
      title: 'Workflow',
      key: 'workflow',
      render: (_: unknown, call: ResourceCall) => (
        <Link href={`/workflows/show/${call.workflowId}?tab=graph`}>{call.workflowName}</Link>
      ),
    },
    {
      title: 'Nœud',
      key: 'node',
      render: (_: unknown, call: ResourceCall) => (
        <Space size={4} wrap>
          <span>{call.nodeName}</span>
          {call.disabled && <Tag>désactivé</Tag>}
        </Space>
      ),
    },
    {
      title: 'Méthode',
      key: 'method',
      width: 110,
      render: (_: unknown, call: ResourceCall) => <Tag>{call.method ?? '—'}</Tag>,
    },
    {
      title: 'Route appelée',
      key: 'url',
      render: (_: unknown, call: ResourceCall) => (
        <Typography.Text code copyable={{ text: call.url ?? '' }}>
          {call.url ?? '—'}
        </Typography.Text>
      ),
    },
  ];

  return (
    <div style={{ padding: 8 }}>
      <Card title="Ressources externes">
        {/* Empilés pleine largeur sur mobile : à 460 px, le sélecteur sortait de l'écran. */}
        <Space wrap direction={mobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            placeholder="Choisir une ressource (système, base, table, hôte, id…)"
            style={{ width: mobile ? '100%' : 460 }}
            value={resourceKey}
            onChange={(value) => setResourceKey(value)}
            options={options}
            filterOption={false}
            searchValue={search}
            onSearch={setSearch}
          />
          {selected && (
            <Tooltip title="Renommer">
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setRenaming(selected);
                  setNewLabel(selected.aliased ? selected.label : '');
                }}
              />
            </Tooltip>
          )}
          {!isApi && (
            <AutoComplete
              allowClear
              style={{ width: mobile ? '100%' : 260 }}
              placeholder="Colonne ajoutée (facultatif)"
              value={column}
              onChange={(value) => setColumn(value ?? '')}
              options={(result?.knownColumns ?? [])
                .filter((known) => known.toLowerCase().includes(column.trim().toLowerCase()))
                .slice(0, 20)
                .map((known) => ({ value: known }))}
            />
          )}
          <Tooltip
            title={
              scope ? 'Lit les noms de tables dans NocoDB' : 'Choisis une instance dans le menu de gauche'
            }
          >
            <Button block={mobile} disabled={!scope} onClick={() => setNamesOpen(true)}>
              Vrais noms (NocoDB)
            </Button>
          </Tooltip>
          <Tooltip title="Masque les copies DEV/PREPROD">
            <Space size={4}>
              <Switch
                checked={!includeOtherEnvs}
                onChange={(checked) => setIncludeOtherEnvs(!checked)}
                size="small"
              />
              <span>Prod uniquement</span>
            </Space>
          </Tooltip>
        </Space>

        {scope && (
          <NocoDbNamesModal
            open={namesOpen}
            instanceId={scope}
            onClose={() => setNamesOpen(false)}
            onResolved={loadResources}
          />
        )}

        {alreadyThere && (
          <Alert style={{ marginTop: 16 }} type="info" showIcon message="Colonne déjà existante." />
        )}

        {result?.resource && !isApi && counts['to-update'] > 0 && (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message={`${counts['to-update']} nœud${counts['to-update'] > 1 ? 's' : ''} à modifier`}
          />
        )}
      </Card>

      {result?.resource && isApi && (
        <>
          {routes.length > 0 && (
            <Card
              title={`Routes appelées · ${result.calls.length} nœud${result.calls.length > 1 ? 's' : ''} · ${routes.length} route${routes.length > 1 ? 's' : ''}`}
              size="small"
              style={{ marginTop: 8 }}
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {routes.map(([url, count]) => (
                  <Space key={url} size={8}>
                    <Typography.Text code>{url}</Typography.Text>
                    <Typography.Text type="secondary">
                      {count} nœud{count > 1 ? 's' : ''}
                    </Typography.Text>
                  </Space>
                ))}
              </Space>
            </Card>
          )}
          <Card style={{ marginTop: 8 }}>
            <Table
              rowKey={(call) => `${call.workflowId}:${call.nodeName}`}
              loading={busy}
              dataSource={result.calls}
              columns={callColumns}
              size="small"
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
            />
          </Card>
        </>
      )}

      {result?.resource && !isApi && (
        <Card style={{ marginTop: 8 }}>
          <Segmented
            style={{ marginBottom: 12 }}
            value={filter}
            onChange={(value) => setFilter(value as typeof filter)}
            options={[
              { value: 'tout', label: `Tout (${result.usages.length})` },
              ...(['to-update', 'no-action', 'unknown'] as const)
                .filter((impact) => counts[impact] > 0 || filter === impact)
                .map((impact) => ({
                  value: impact,
                  label: `${IMPACT_META[impact].label} (${counts[impact]})`,
                })),
            ]}
          />
          <Table
            rowKey={(usage) => `${usage.workflowId}:${usage.nodeName}`}
            loading={busy}
            dataSource={usages}
            columns={usageColumns}
            size="small"
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
          />
        </Card>
      )}

      {!resourceKey && (
        <Card style={{ marginTop: 8 }}>
          <Empty description="Choisis une ressource pour voir les nœuds qui la touchent" />
        </Card>
      )}

      <Modal
        title="Nommer la ressource"
        open={renaming !== null}
        onOk={submitRename}
        onCancel={() => setRenaming(null)}
        okText="Enregistrer"
        cancelText="Annuler"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">{renaming?.key}</Typography.Text>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Ex : NocoDB · Contacts CRM"
            onPressEnter={submitRename}
            autoFocus
          />
          <Typography.Text type="secondary">Vide = nom automatique.</Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
