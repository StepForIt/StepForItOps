'use client';

import React from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Table } from './resizable-table';
import { MermaidView } from './mermaid-view';
import { apiGet } from '../lib/api';

interface NextLink {
  node: string;
  branch?: string;
}

interface ViewNode {
  name: string;
  type: string;
  typeVersion?: number;
  disabled: boolean;
  notes?: string;
  sticky: boolean;
  credentials: string[];
  order: number;
  entry: boolean;
  incoming: number;
  outgoing: number;
  next: NextLink[];
  parameters: Record<string, unknown>;
}

/** Finding déjà en base : la vue les affiche tels quels, sans relancer d'analyse. */
interface ViewFinding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName: string | null;
  suggestion: string | null;
  /** Position dans le code du nœud, pour les findings de nœud Code. */
  line: number | null;
  snippet: string | null;
  snippetStart: number | null;
}

interface WorkflowView {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  /** Publié, sur les n8n qui séparent brouillon et version publiée ; `null` sinon. */
  published: boolean | null;
  tags: string[];
  n8nUrl: string;
  platform: 'n8n' | 'make';
  actions: Record<string, { available: boolean; why?: string }>;
  hash: string;
  updatedAt: string;
  mermaid: string;
  nodes: ViewNode[];
  findings: ViewFinding[];
  stats: { nodes: number; stickies: number; disabled: number; connections: number; orphans: string[] };
}

const shortType = (type: string) => type.split('.').pop() ?? type;

const severityColor: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };

/**
 * La STRUCTURE d'un workflow : son schéma et l'inventaire de ses nœuds, lus en
 * un appel (`GET /workflows/:id/view`).
 *
 * Elle vivait sur une page à part (`/workflows/view/:id`), que la fiche
 * renvoyait par un bouton — on quittait la fiche pour regarder le workflow, et
 * les findings s'affichaient des deux côtés. C'est désormais deux onglets de la
 * fiche, et cette page redirige vers elle.
 */
export function useWorkflowStructure(workflowId: string, enabled: boolean) {
  const [view, setView] = React.useState<WorkflowView | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!enabled) return;
    setLoading(true);
    apiGet<WorkflowView>(`/workflows/${workflowId}/view`)
      .then((data) => {
        setView(data);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // Chargé à l'ouverture de l'onglet seulement : la fiche s'affiche sans
    // attendre un schéma qu'on ne regarde pas à chaque visite.
  }, [workflowId, enabled]);

  React.useEffect(load, [load]);

  return { view, loading, error, reload: load };
}

/** Le schéma, précédé de ce qu'on lit d'un coup d'œil : nœuds désactivés, orphelins, taille. */
export function WorkflowGraph({ view }: { view: WorkflowView }) {
  const t = useTranslations('reviewTools.structure');
  const locale = useLocale();
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap size={4}>
        {view.stats.disabled > 0 && <Tag color="orange">{t('disabled', { count: view.stats.disabled })}</Tag>}
        {view.stats.orphans.length > 0 && (
          <Tag color="volcano">{t('orphans', { nodes: view.stats.orphans.join(', ') })}</Tag>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t.rich('stats', {
            nodes: view.stats.nodes,
            connections: view.stats.connections,
            stickies: view.stats.stickies,
            synced: new Date(view.updatedAt).toLocaleString(locale),
            hash: () => <code>{view.hash.slice(0, 10)}</code>,
          })}
        </Typography.Text>
      </Space>
      <MermaidView code={view.mermaid} />
    </Space>
  );
}

/** L'inventaire des nœuds : ordre, enchaînement, type, credentials, notes. */
export function WorkflowNodes({ view }: { view: WorkflowView }) {
  const t = useTranslations('reviewTools.structure');
  const tCommon = useTranslations('common');
  const nodes = view.nodes.filter((node) => !node.sticky);
  // Findings déjà en base, pour pastiller les nœuds qui en portent.
  const findingsByNode = new Map<string, ViewFinding[]>();
  for (const finding of view.findings) {
    if (!finding.nodeName) continue;
    findingsByNode.set(finding.nodeName, [...(findingsByNode.get(finding.nodeName) ?? []), finding]);
  }

  return (
    <Table
      dataSource={nodes}
      rowKey="name"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      expandable={{
        expandedRowRender: (node) => (
          <pre style={{ maxHeight: 320, overflow: 'auto', fontSize: 12, margin: 0 }}>
            {JSON.stringify(node.parameters, null, 2)}
          </pre>
        ),
      }}
    >
      <Table.Column
        title="#"
        dataIndex="order"
        width={44}
        render={(order: number) => <Typography.Text type="secondary">{order}</Typography.Text>}
      />
      <Table.Column<ViewNode>
        title={tCommon('columns.node')}
        dataIndex="name"
        width={260}
        render={(name: string, node) => {
          const nodeFindings = findingsByNode.get(name) ?? [];
          return (
            <Space size={4} style={{ maxWidth: 260 }}>
              <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 175 }}>
                {name}
              </Typography.Text>
              {node.entry && <Tag color="blue">{t('entry')}</Tag>}
              {node.disabled && <Tag color="orange">{t('off')}</Tag>}
              {nodeFindings.length > 0 && (
                <Tooltip title={nodeFindings.map((f) => `${f.severity} — ${f.message}`).join('\n')}>
                  <Tag color={severityColor[nodeFindings[0].severity]}>{nodeFindings.length}</Tag>
                </Tooltip>
              )}
            </Space>
          );
        }}
      />
      <Table.Column<ViewNode>
        title={t('next')}
        dataIndex="next"
        width={240}
        render={(next: NextLink[]) =>
          next.length === 0 ? (
            <Typography.Text type="secondary">{t('end')}</Typography.Text>
          ) : (
            <Space size={4} wrap>
              {next.map((link) => (
                <Tag
                  key={`${link.branch ?? ''}${link.node}`}
                  color="blue"
                  title={`${link.branch ? `${link.branch} → ` : '→ '}${link.node}`}
                  style={{ maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {link.branch ? `${link.branch} → ` : '→ '}
                  {link.node}
                </Tag>
              ))}
            </Space>
          )
        }
      />
      <Table.Column
        title={tCommon('columns.type')}
        dataIndex="type"
        render={(type: string) => <Typography.Text type="secondary">{shortType(type)}</Typography.Text>}
      />
      <Table.Column
        title={t('credentials')}
        dataIndex="credentials"
        render={(credentials: string[]) => (credentials.length > 0 ? credentials.join(', ') : '—')}
      />
      <Table.Column
        title={t('note')}
        dataIndex="notes"
        width={220}
        render={(notes?: string) =>
          notes ? (
            <Typography.Paragraph
              type="secondary"
              ellipsis={{ rows: 2, tooltip: notes }}
              style={{ margin: 0, maxWidth: 220, fontSize: 12 }}
            >
              {notes}
            </Typography.Paragraph>
          ) : (
            '—'
          )
        }
      />
    </Table>
  );
}

/** Nœuds hors sticky notes : ce que comptent les onglets. */
export function countNodes(view: WorkflowView | null): number {
  return (view?.nodes ?? []).filter((node) => !node.sticky).length;
}
