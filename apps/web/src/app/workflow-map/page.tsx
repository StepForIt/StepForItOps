'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Table } from '../../components/resizable-table';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { keyColor } from '../../lib/graph-colors';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { MermaidView } from '../../components/mermaid-view';
import { WorkflowMapHelp } from './workflow-map-help';
import { WorkflowLinkModal, WorkflowLinkFormValues } from './workflow-link-modal';
import type { TriggerKind, WorkflowMapLink, WorkflowMapNode } from './types';
import { useEnvs } from '../../lib/envs';
import { BRAND } from '../../lib/brand/colors';

type MapT = ReturnType<typeof useTranslations<'inventory.workflowMap.page'>>;

const KIND_KEYS = ['execute', 'tool', 'webhook', 'manual'] as const;
type LinkKind = (typeof KIND_KEYS)[number];
const isKnownKind = (kind: string): kind is LinkKind => (KIND_KEYS as readonly string[]).includes(kind);

/** Libellé d'une nature de lien ; une nature inconnue s'affiche telle quelle. */
function kindLabel(kind: string, t: MapT): string {
  return isKnownKind(kind) ? t(`kinds.${kind}`) : kind;
}

const KIND_COLORS: Record<string, string> = {
  execute: 'blue',
  tool: 'purple',
  webhook: 'cyan',
  manual: 'magenta',
};

const ALL_KINDS = ['execute', 'tool', 'webhook', 'manual'];

/** Appels qui lancent le workflow cible *en sous-workflow* (par opposition à un webhook). */
const SUB_CALL_KINDS = ['execute', 'tool'];

const TRIGGER_KEYS = {
  schedule: 'schedule',
  webhook: 'webhook',
  form: 'form',
  chat: 'chat',
  app: 'app',
  error: 'error',
  'sub-workflow': 'subWorkflow',
  // Le trigger manuel sert à tester : affiché, mais il ne compte pas dans la nature du workflow.
  manual: 'manual',
} as const satisfies Record<TriggerKind, string>;

/** Ne tourne jamais seul : hors bouton de test, il ne démarre que sur appel d'un autre workflow. */
function isSubWorkflowOnly(node: WorkflowMapNode): boolean {
  const real = (node.triggers ?? []).filter((kind) => kind !== 'manual');
  return real.length === 1 && real[0] === 'sub-workflow';
}

/** Comment ce workflow démarre, en une ligne — vide s'il n'a plus aucun trigger actif. */
function triggersLabel(node: WorkflowMapNode, t: MapT): string {
  return (node.triggers ?? []).map((kind) => t(`triggers.${TRIGGER_KEYS[kind]}`)).join(' · ');
}

const MAX_GRAPH_NODES = 80;

const CONTEXT_KEYS = {
  loop: 'loop',
  manual: 'manual',
  'sub-workflow': 'subWorkflow',
} as const satisfies Record<NonNullable<WorkflowMapLink['context']>['kind'], string>;

/**
 * Libellé de la flèche : le contexte de départ (boucle, test, sous-workflow) quand l'appel ne part
 * pas d'un flux ordinaire, sinon rien pour un `execute` banal — la flèche dit déjà « appelle ».
 */
function linkLabel(link: WorkflowMapLink, t: MapT): string | null {
  if (link.context) {
    return t('contextLabel', {
      context: t(`contexts.${CONTEXT_KEYS[link.context.kind]}`),
      count: link.context.nodeCount,
    });
  }
  if (link.kind === 'execute') return null;
  return kindLabel(link.kind, t);
}

function workflowHref(id: string): string {
  return `/workflows/show/${encodeURIComponent(id)}?tab=graph`;
}

/** Ce que le workflow est sur la carte — c'est ce qui donne sa couleur à sa boîte. */
function nodeClass(node: WorkflowMapNode): string {
  if (node.external) return 'external';
  if (node.archived) return 'archived';
  if (node.active === false) return 'inactive';
  if (isSubWorkflowOnly(node)) return 'subworkflow';
  return 'workflow';
}

// Les flèches d'un même workflow partagent une couleur tirée de son id (`keyColor`) : on suit son
// trait des yeux, la nature du lien étant portée par l'étiquette. Les points d'entrée gardent le
// vert de leur pastille — seul repère fixe du schéma.
const ENTRY_STROKE = BRAND.success;

/** Flowchart Mermaid du schéma : liens détectés en trait plein, liens manuels en pointillés. */
function toMermaid(
  nodes: WorkflowMapNode[],
  links: WorkflowMapLink[],
  showEntryPoints: boolean,
  t: MapT,
): string {
  // Troncature par le milieu : le suffixe qui départage les homonymes (· instance, · #id) doit survivre.
  const escape = (label: string) => {
    const clean = label.replace(/"/g, '#quot;');
    return clean.length <= 60 ? clean : `${clean.slice(0, 36)}…${clean.slice(-22)}`;
  };
  const lines = ['flowchart LR'];
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));

  // `linkStyle` désigne les flèches par leur rang de déclaration : on numérote donc au fil de
  // l'écriture, et on regroupe les rangs par couleur pour ne pas produire une ligne par flèche.
  let edgeCount = 0;
  const edgesByColor = new Map<string, number[]>();
  const pushEdge = (line: string, color: string) => {
    lines.push(line);
    edgesByColor.set(color, [...(edgesByColor.get(color) ?? []), edgeCount]);
    edgeCount += 1;
  };

  for (const [index, node] of nodes.entries()) {
    const id = `n${index}`;
    // Pied de boîte : comment le workflow démarre. « aucun trigger » = il ne peut plus partir seul.
    const triggers = node.external
      ? ''
      : `<span class="wf-triggers">${escape(triggersLabel(node, t) || t('noTrigger'))}</span>`;
    const label = `${escape(node.name)}${triggers}`;
    lines.push(`  ${id}["${label}"]:::${nodeClass(node)}`);
    // Une cible hors périmètre n'a pas de fiche : elle reste un simple encadré.
    if (!node.external) lines.push(`  click ${id} href "${workflowHref(node.id)}" "${t('openWorkflow')}"`);

    // Déclencheurs externes (URL publique, horloge, appli tierce) dessinés devant la boîte :
    // sans eux un workflow d'entrée aurait l'air de n'avoir rien en amont.
    if (showEntryPoints) {
      for (const [entryIndex, entry] of (node.entryPoints ?? []).entries()) {
        const entryId = `e${index}_${entryIndex}`;
        lines.push(`  ${entryId}(["${escape(entry.label)}"]):::entry`);
        pushEdge(`  ${entryId} -.-> ${id}`, ENTRY_STROKE);
      }
    }
  }

  // Auto-appel : une flèche qui revient sur sa propre boîte se lit mal, on dessine la cible
  // comme une seconde boîte — le même workflow lancé en sous-workflow, ce qui se passe vraiment.
  let selfCalls = 0;
  for (const link of links) {
    const from = indexOf.get(link.fromId);
    const to = indexOf.get(link.toId);
    if (from === undefined || to === undefined) continue;
    let target = `n${to}`;
    const color = keyColor(link.fromId);
    if (link.origin === 'auto' && link.fromId === link.toId && SUB_CALL_KINDS.includes(link.kind)) {
      target = `s${selfCalls++}`;
      lines.push(`  ${target}["${escape(t('selfCall'))}"]:::subcall`);
      lines.push(`  click ${target} href "${workflowHref(link.toId)}" "${t('openWorkflow')}"`);
    }
    if (link.origin === 'manual') {
      const label = link.label ? escape(link.label) : '';
      pushEdge(label ? `  n${from} -. "${label}" .-> ${target}` : `  n${from} -.-> ${target}`, color);
    } else {
      const label = linkLabel(link, t);
      pushEdge(label ? `  n${from} -- ${label} --> ${target}` : `  n${from} --> ${target}`, color);
    }
  }

  for (const [color, indexes] of edgesByColor) {
    lines.push(`  linkStyle ${indexes.join(',')} stroke:${color},stroke-width:1.6px;`);
  }

  lines.push(`  classDef workflow fill:${BRAND.primarySoft},stroke:${BRAND.primary};`);
  lines.push('  classDef inactive fill:#fafafa,stroke:#bfbfbf,color:#8c8c8c;');
  lines.push('  classDef archived fill:#f5f5f5,stroke:#d9d9d9,color:#8c8c8c,stroke-dasharray: 4 4;');
  lines.push('  classDef external fill:#fff7e6,stroke:#fa8c16,stroke-dasharray: 4 4;');
  lines.push('  classDef subworkflow fill:#f9f0ff,stroke:#722ed1;');
  lines.push('  classDef subcall fill:#f9f0ff,stroke:#722ed1,stroke-dasharray: 4 4;');
  lines.push('  classDef entry fill:#f6ffed,stroke:#52c41a,stroke-dasharray: 4 4,color:#389e0d;');
  return lines.join('\n');
}

export default function WorkflowMapPage() {
  const t = useTranslations('inventory.workflowMap.page');
  const { scope } = useInstanceScope();
  const [nodes, setNodes] = useState<WorkflowMapNode[]>([]);
  const [links, setLinks] = useState<WorkflowMapLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = usePersistedState('q', '');
  const [kinds, setKinds] = usePersistedState<string[]>('kinds', ALL_KINDS, {
    validate: (value) =>
      Array.isArray(value) ? value.filter((kind): kind is string => ALL_KINDS.includes(kind)) : undefined,
  });
  const [hideIsolated, setHideIsolated] = usePersistedState('hideIsolated', true);
  // Un parc dev/prod affiche chaque workflow métier deux fois : la carte devient
  // illisible pour rien, puisque les deux exemplaires ont le même schéma d'appels.
  // Env indéterminé ⇒ gardé, comme partout (un parc non étiqueté serait sinon vide).
  const [prodOnly, setProdOnly] = usePersistedState('prodOnly', true);
  // Les envs déclarés surveillés : eux seuls restent quand le filtre est armé.
  const { envs: declaredEnvs } = useEnvs();
  const monitoredEnvs = useMemo(
    () => declaredEnvs.filter((env) => env.monitored).map((env) => env.id),
    [declaredEnvs],
  );
  const [showEntryPoints, setShowEntryPoints] = usePersistedState('showEntryPoints', true);
  // Sans choix retenu, l'état suit le réglage global « inclure les workflows archivés ».
  const [archivedChoice, setHideArchived] = usePersistedState<boolean | null>('hideArchived', null, {
    validate: (value) => (typeof value === 'boolean' ? value : undefined),
  });
  const [archivedDefault, setArchivedDefault] = useState(true);
  const hideArchived = archivedChoice ?? archivedDefault;
  useEffect(() => {
    if (archivedChoice !== null) return;
    apiGet<{ includeArchived: boolean }>('/settings/platform')
      .then((settings) => setArchivedDefault(!settings.includeArchived))
      .catch(() => undefined);
  }, [archivedChoice]);
  const [view, setView] = usePersistedState<'graphe' | 'tableau'>('view', 'graphe', {
    validate: (value) => (value === 'graphe' || value === 'tableau' ? value : undefined),
  });
  const [editing, setEditing] = useState<WorkflowMapLink | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (scope) params.set('instanceId', scope);
      const result = await apiGet<{ nodes: WorkflowMapNode[]; links: WorkflowMapLink[] }>(
        `/workflow-map?${params}`,
      );
      setNodes(result.nodes);
      setLinks(result.links);
      setLoaded(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /** Nom du workflow, cliquable vers sa fiche — sauf pour une cible hors périmètre. */
  const renderNodeName = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return (id: string) => {
      const node = byId.get(id);
      if (!node) return id;
      if (node.external) {
        return (
          <Space size={4}>
            <span>{node.name}</span>
            <Tag color="orange">{t('outOfScope')}</Tag>
          </Space>
        );
      }
      return (
        <Tooltip title={t('startsWith', { triggers: triggersLabel(node, t) || t('noTrigger') })}>
          <Link href={workflowHref(node.id)}>{node.name}</Link>
        </Tooltip>
      );
    };
  }, [nodes, t]);

  /** Nœuds et liens réellement affichés, après filtres kind / recherche / isolés. */
  const visible = useMemo(() => {
    let keptLinks = links.filter((l) => kinds.includes(l.kind));
    let keptNodes = nodes;

    if (prodOnly) {
      keptNodes = keptNodes.filter((n) => n.external || n.env == null || monitoredEnvs.includes(n.env));
    }

    if (hideArchived) {
      // Un archivé ne tourne plus : appels sortants masqués, mais il reste affiché s'il est
      // appelé par un workflow vivant — appel mort à corriger.
      const archived = new Set(keptNodes.filter((n) => n.archived).map((n) => n.id));
      keptLinks = keptLinks.filter((l) => !archived.has(l.fromId));
      const stillTargeted = new Set(keptLinks.filter((l) => archived.has(l.toId)).map((l) => l.toId));
      keptNodes = keptNodes.filter((n) => !archived.has(n.id) || stillTargeted.has(n.id));
    }

    const query = q.trim().toLowerCase();
    if (query) {
      const matched = new Set(keptNodes.filter((n) => n.name.toLowerCase().includes(query)).map((n) => n.id));
      // On garde les voisins directs : un point isolé ne raconte rien.
      keptLinks = keptLinks.filter((l) => matched.has(l.fromId) || matched.has(l.toId));
      const neighbours = new Set([...matched]);
      for (const link of keptLinks) {
        neighbours.add(link.fromId);
        neighbours.add(link.toId);
      }
      keptNodes = keptNodes.filter((n) => neighbours.has(n.id));
    }

    // Une cible hors périmètre n'existe que par ses liens : elle disparaît avec eux.
    const linked = new Set(keptLinks.flatMap((l) => [l.fromId, l.toId]));
    keptNodes = keptNodes.filter((n) => (hideIsolated || n.external ? linked.has(n.id) : true));

    const shown = new Set(keptNodes.map((n) => n.id));
    keptLinks = keptLinks.filter((l) => shown.has(l.fromId) && shown.has(l.toId));
    return { nodes: keptNodes, links: keptLinks };
  }, [nodes, links, kinds, q, hideIsolated, hideArchived, prodOnly, monitoredEnvs]);

  const manualLinks = useMemo(() => links.filter((l) => l.origin === 'manual'), [links]);
  const linkableWorkflows = useMemo(() => nodes.filter((n) => !n.external), [nodes]);

  const submitLink = async (values: WorkflowLinkFormValues) => {
    try {
      if (editing) {
        await apiPatch(`/workflow-map/links/${editing.id}`, { label: values.label, note: values.note });
        message.success(t('linkUpdated'));
      } else {
        await apiPost('/workflow-map/links', values);
        message.success(t('linkAdded'));
      }
      setEditing(null);
      setCreating(false);
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const removeLink = async (id: string) => {
    try {
      await apiDelete(`/workflow-map/links/${id}`);
      message.success(t('linkDeleted'));
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const autoCount = links.length - manualLinks.length;
  const archivedCount = nodes.filter((n) => n.archived).length;
  const outOfProdCount = nodes.filter(
    (n) => !n.external && n.env != null && !monitoredEnvs.includes(n.env),
  ).length;

  return (
    <div style={{ padding: 8 }}>
      <Card title={t('title')}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {t('intro')}
        </Typography.Paragraph>
        <Space wrap>
          <Input
            placeholder={t('filterPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            allowClear
            style={{ width: 260 }}
          />
          <Checkbox.Group
            value={kinds}
            onChange={(values) => setKinds(values as string[])}
            options={ALL_KINDS.map((value) => ({ value, label: kindLabel(value, t) }))}
          />
          <Tooltip title={t('hideIsolatedHint')}>
            <Space size={4}>
              <Switch checked={hideIsolated} onChange={setHideIsolated} size="small" />
              <span>{t('hideIsolated')}</span>
            </Space>
          </Tooltip>
          <Tooltip title={t('entryPointsHint')}>
            <Space size={4}>
              <Switch checked={showEntryPoints} onChange={setShowEntryPoints} size="small" />
              <span>{t('entryPoints')}</span>
            </Space>
          </Tooltip>
          <Tooltip title={t('monitoredHint')}>
            <Space size={4}>
              <Switch checked={prodOnly} onChange={setProdOnly} size="small" />
              <span>{t('monitored')}</span>
            </Space>
          </Tooltip>
          <Tooltip title={t('hideArchivedHint')}>
            <Space size={4}>
              <Switch checked={hideArchived} onChange={setHideArchived} size="small" />
              <span>{t('hideArchived')}</span>
            </Space>
          </Tooltip>
          <Segmented
            options={[
              { value: 'graphe', label: t('viewGraph') },
              { value: 'tableau', label: t('viewTable') },
            ]}
            value={view}
            onChange={(v) => setView(v as 'graphe' | 'tableau')}
          />
          <Button icon={<ReloadOutlined />} loading={busy} onClick={() => load()}>
            {t('refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('addLink')}
          </Button>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Space size={4} wrap>
            <Tag>{t('counts.live', { count: nodes.filter((n) => !n.external && !n.archived).length })}</Tag>
            {archivedCount > 0 && <Tag>{t('counts.archived', { count: archivedCount })}</Tag>}
            {prodOnly && outOfProdCount > 0 && <Tag>{t('counts.hidden', { count: outOfProdCount })}</Tag>}
            <Tag color="blue">{t('counts.detected', { count: autoCount })}</Tag>
            <Tag color="magenta">{t('counts.manual', { count: manualLinks.length })}</Tag>
          </Space>
        </div>
      </Card>

      <WorkflowMapHelp defaultOpen={loaded && links.length === 0} />

      {loaded && nodes.length === 0 && !busy && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={t('noWorkflow')}
          description={t('noWorkflowDescription')}
        />
      )}

      {loaded && nodes.length > 0 && visible.nodes.length === 0 && !busy && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={t('nothingToShow')}
          description={t('nothingToShowDescription')}
        />
      )}

      {visible.nodes.length > 0 && view === 'graphe' && (
        <Card
          title={t('graphTitle', { nodes: visible.nodes.length, links: visible.links.length })}
          style={{ marginTop: 16 }}
        >
          {visible.nodes.length > MAX_GRAPH_NODES ? (
            <Alert type="warning" showIcon message={t('tooMany')} />
          ) : (
            <>
              <Typography.Paragraph type="secondary">{t('clickHint')}</Typography.Paragraph>
              {/* Pied de boîte des déclencheurs : une note en bas de l'encadré, pas un titre. */}
              <style>{`
                .wf-triggers {
                  display: block;
                  margin-top: 6px;
                  padding-top: 4px;
                  border-top: 1px solid rgba(0, 0, 0, 0.12);
                  font-size: 0.78em;
                  font-style: italic;
                  color: #8c8c8c;
                }
              `}</style>
              <MermaidView
                code={toMermaid(visible.nodes, visible.links, showEntryPoints, t)}
                interactive
                layout="elk"
                startDots
              />
            </>
          )}
        </Card>
      )}

      {visible.nodes.length > 0 && view === 'tableau' && (
        <Card title={t('linksTitle', { count: visible.links.length })} style={{ marginTop: 16 }}>
          <Table dataSource={visible.links} rowKey="id" size="small">
            <Table.Column<WorkflowMapLink>
              dataIndex="fromId"
              title={t('columns.workflow')}
              render={renderNodeName}
            />
            <Table.Column<WorkflowMapLink>
              dataIndex="kind"
              title={t('columns.relation')}
              render={(kind: string, record) => (
                <Space size={4}>
                  <Tag color={KIND_COLORS[kind]}>{kindLabel(kind, t)}</Tag>
                  {record.context && (
                    <Tooltip
                      title={t('contextTooltip', {
                        hint: t(`contextHints.${CONTEXT_KEYS[record.context.kind]}`),
                        count: record.context.nodeCount,
                      })}
                    >
                      <Tag>{linkLabel(record, t)}</Tag>
                    </Tooltip>
                  )}
                  {record.label && <span>{record.label}</span>}
                </Space>
              )}
            />
            <Table.Column<WorkflowMapLink> dataIndex="toId" title={t('columns.to')} render={renderNodeName} />
            <Table.Column<WorkflowMapLink>
              dataIndex="nodeNames"
              title={t('columns.detectedOn')}
              render={(names: string[] | undefined, record: WorkflowMapLink) =>
                names?.length ? names.map((n) => <Tag key={n}>{n}</Tag>) : record.note || '—'
              }
            />
          </Table>
        </Card>
      )}

      <Card title={t('manualTitle', { count: manualLinks.length })} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">{t('manualIntro')}</Typography.Paragraph>
        {manualLinks.length === 0 ? (
          <Alert type="info" showIcon message={t('noManual')} description={t('noManualDescription')} />
        ) : (
          <Table dataSource={manualLinks} rowKey="id" size="small" pagination={false}>
            <Table.Column<WorkflowMapLink>
              dataIndex="fromId"
              title={t('columns.from')}
              render={renderNodeName}
            />
            <Table.Column<WorkflowMapLink> dataIndex="toId" title={t('columns.to')} render={renderNodeName} />
            <Table.Column<WorkflowMapLink>
              dataIndex="label"
              title={t('columns.label')}
              render={(l?: string) => l || '—'}
            />
            <Table.Column<WorkflowMapLink>
              dataIndex="note"
              title={t('columns.note')}
              render={(n?: string) => n || '—'}
            />
            <Table.Column<WorkflowMapLink>
              title=""
              width={100}
              render={(_, record) => (
                <Space>
                  <Tooltip title={t('editHint')}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(record)} />
                  </Tooltip>
                  <Popconfirm
                    title={t('deleteConfirm')}
                    okText={t('delete')}
                    cancelText={t('cancel')}
                    onConfirm={() => removeLink(record.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              )}
            />
          </Table>
        )}
      </Card>

      <WorkflowLinkModal
        open={creating || editing !== null}
        workflows={linkableWorkflows}
        editing={editing}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={submitLink}
      />
    </div>
  );
}
