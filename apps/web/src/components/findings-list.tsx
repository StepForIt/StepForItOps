'use client';

import React, { useMemo, useState } from 'react';
import { Badge, Button, Collapse, Segmented, Space, Tag, Tooltip, message } from 'antd';
import { Table } from './resizable-table';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiPost } from '../lib/api';
import { useRuleLabel } from '../lib/finding-rules';
import { FindingCode } from './finding-code';
import { IgnorableFinding, IgnoreFindingModal } from './ignore-finding-modal';
import { useWorkflowChat } from './workflow-chat-drawer';
import { ProposalReviewModal } from './proposal-review-modal';
import { usePersistedState } from '../lib/list-memory/use-list-memory';

export interface DisplayFinding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName?: string | null;
  /** Correctif proposé par la règle, affiché sous le message. */
  suggestion?: string | null;
  line?: number | null;
  snippet?: string | null;
  snippetStart?: number | null;
  /** La règle sait écrire le correctif seule : il s'applique sans IA, après revue du diff. */
  autoFix?: boolean;
}

type GroupBy = 'node' | 'rule' | 'module' | 'none';
const GROUP_BY: GroupBy[] = ['node', 'rule', 'module', 'none'];

const SEVERITY_COLOR: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

interface Props {
  findings: DisplayFinding[];
  /** Rechargement après « Ignorer » (les findings couverts sont supprimés en base). */
  onChanged: () => void;
  /** Boutons propres à la page appelante (renommage, sticky notes…). */
  actions?: React.ReactNode;
  /** Message affiché quand il n'y a rien à montrer. */
  emptyText?: string;
}

/**
 * Liste des findings d'un workflow, groupée. Une liste à plat de 40 lignes ne se
 * lit pas : les six remarques d'un même nœud Code se corrigent d'une seule
 * réécriture, et c'est le nœud — pas la ligne — qui est l'unité de travail.
 * D'où le regroupement par nœud par défaut, et des actions (corriger, ignorer)
 * portées par le groupe autant que par la ligne.
 */
export function FindingsList({ findings, onChanged, actions, emptyText }: Props) {
  const [groupBy, setGroupBy] = usePersistedState<GroupBy>('findingsGroupBy', 'node', {
    validate: (value) => (GROUP_BY.includes(value as GroupBy) ? (value as GroupBy) : undefined),
  });
  const [ignoring, setIgnoring] = useState<DisplayFinding[] | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const chat = useWorkflowChat();
  const t = useTranslations('reviewTools.findings');
  const tCommon = useTranslations('common');
  const ruleLabel = useRuleLabel();

  const groups = useMemo(
    () => buildGroups(findings, groupBy, { rule: ruleLabel, noNode: t('noNode') }),
    [findings, groupBy, ruleLabel, t],
  );

  /** Un ou plusieurs findings → conversation IA pré-alimentée, proposition revue en diff. */
  const proposeFix = async (key: string, target: DisplayFinding[]) => {
    setFixing(key);
    // L'appel dure plusieurs secondes : sans ce mot, un bouton qui tourne se lit
    // comme une page figée, et on reclique.
    const done = message.loading(
      target.length === 1 ? t('fixingOne') : t('fixingMany', { count: target.length }),
      0,
    );
    try {
      const result = await apiPost<{ workflowId: string; sessionId: string; proposalId: string | null }>(
        '/workflow-chat/finding-fix',
        { findingIds: target.map((finding) => finding.id) },
      );
      message.success(result.proposalId ? t('fixProposed') : t('noFixProposed'));
      // La réponse s'ouvre sur place : y aller par un changement de page rechargeait
      // toute la console juste pour lire un diff, et faisait perdre la liste en cours.
      chat.open({
        workflowId: result.workflowId,
        sessionId: result.sessionId,
        onWorkflowChanged: onChanged,
      });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setFixing(null);
      done();
    }
  };

  /** Correctif calculé par la règle : proposition ordinaire, revue en diff avant toute écriture. */
  const applyFix = async (key: string, target: DisplayFinding[]) => {
    setFixing(key);
    try {
      const result = await apiPost<{ proposalId: string; skipped: number }>(
        '/workflow-chat/finding-autofix',
        {
          findingIds: target.map((finding) => finding.id),
        },
      );
      if (result.skipped > 0) message.info(t('autofixSkipped', { count: result.skipped }));
      setReviewing(result.proposalId);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setFixing(null);
    }
  };

  if (findings.length === 0) {
    return <p style={{ color: '#999' }}>{emptyText ?? t('empty')}</p>;
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented<GroupBy>
          size="small"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'node', label: t('groupBy.node') },
            { value: 'rule', label: t('groupBy.rule') },
            { value: 'module', label: t('groupBy.module') },
            { value: 'none', label: t('groupBy.none') },
          ]}
        />
        {actions}
      </Space>

      {groupBy === 'none' ? (
        <FindingsTable
          findings={findings}
          columns={{ node: true, rule: true, module: true }}
          onIgnore={(finding) => setIgnoring([finding])}
          onFix={(finding) => proposeFix(finding.id, [finding])}
          onApply={(finding) => applyFix(finding.id, [finding])}
          fixing={fixing}
        />
      ) : (
        <Collapse
          size="small"
          defaultActiveKey={groups.slice(0, 3).map((group) => group.key)}
          items={groups.map((group) => ({
            key: group.key,
            label: (
              <Space size={8} wrap>
                <strong>{group.label}</strong>
                <SeverityBadges findings={group.findings} />
              </Space>
            ),
            extra: (
              <Space size={4} onClick={(event) => event.stopPropagation()}>
                {group.findings.some((finding) => finding.autoFix) && (
                  <Tooltip title={t('autofixTooltip')}>
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={fixing === `auto|${group.key}`}
                      onClick={() =>
                        applyFix(
                          `auto|${group.key}`,
                          group.findings.filter((finding) => finding.autoFix),
                        )
                      }
                    >
                      {tCommon('apply')}
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title={t('fixWithAi')}>
                  <Button
                    size="small"
                    icon={<RobotOutlined />}
                    loading={fixing === group.key}
                    onClick={() => proposeFix(group.key, group.findings)}
                  >
                    {t('fix')}
                  </Button>
                </Tooltip>
                <Tooltip title={t('ignoreGroupTooltip')}>
                  <Button size="small" onClick={() => setIgnoring(group.findings)}>
                    {t('ignore')}
                  </Button>
                </Tooltip>
              </Space>
            ),
            children: (
              <FindingsTable
                findings={group.findings}
                columns={{
                  node: groupBy !== 'node',
                  rule: groupBy !== 'rule',
                  module: groupBy !== 'module',
                }}
                onIgnore={(finding) => setIgnoring([finding])}
                onFix={(finding) => proposeFix(finding.id, [finding])}
                onApply={(finding) => applyFix(finding.id, [finding])}
                fixing={fixing}
              />
            ),
          }))}
        />
      )}

      <IgnoreFindingModal
        findings={ignoring as IgnorableFinding[] | null}
        onClose={() => setIgnoring(null)}
        onIgnored={onChanged}
      />
      <ProposalReviewModal proposalId={reviewing} onClose={() => setReviewing(null)} onResolved={onChanged} />
    </>
  );
}

function SeverityBadges({ findings }: { findings: DisplayFinding[] }) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity in counts) counts[finding.severity as keyof typeof counts]++;
  }
  return (
    <Space size={4}>
      {(['error', 'warning', 'info'] as const).map((severity) =>
        counts[severity] > 0 ? (
          <Badge key={severity} count={counts[severity]} color={SEVERITY_COLOR[severity]} />
        ) : null,
      )}
    </Space>
  );
}

function FindingsTable({
  findings,
  columns,
  onIgnore,
  onFix,
  onApply,
  fixing,
}: {
  findings: DisplayFinding[];
  columns: { node: boolean; rule: boolean; module: boolean };
  onIgnore: (finding: DisplayFinding) => void;
  onFix: (finding: DisplayFinding) => void;
  onApply: (finding: DisplayFinding) => void;
  fixing: string | null;
}) {
  const t = useTranslations('reviewTools.findings');
  const tCommon = useTranslations('common');
  const ruleLabel = useRuleLabel();
  return (
    <Table dataSource={findings} rowKey="id" size="small" pagination={false}>
      <Table.Column
        dataIndex="severity"
        title={t('columns.severity')}
        width={90}
        render={(severity: string) => <Tag color={SEVERITY_COLOR[severity]}>{severity}</Tag>}
      />
      {columns.module && (
        <Table.Column
          dataIndex="module"
          title={t('columns.module')}
          width={110}
          render={(module: string) => <Tag>{module}</Tag>}
        />
      )}
      {columns.rule && (
        <Table.Column
          dataIndex="code"
          title={t('columns.rule')}
          width={200}
          render={(code: string) => <Tooltip title={code}>{ruleLabel(code)}</Tooltip>}
        />
      )}
      {columns.node && (
        <Table.Column
          dataIndex="nodeName"
          title={tCommon('columns.node')}
          width={180}
          render={(nodeName?: string | null) => nodeName ?? '—'}
        />
      )}
      <Table.Column<DisplayFinding>
        dataIndex="message"
        title={tCommon('columns.message')}
        render={(text: string, record) => (
          <>
            {text}
            {record.suggestion && (
              <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>💡 {record.suggestion}</div>
            )}
          </>
        )}
      />
      <Table.Column<DisplayFinding>
        title={t('columns.code')}
        width={70}
        render={(_, record) => (
          <FindingCode
            line={record.line ?? undefined}
            snippet={record.snippet ?? undefined}
            snippetStart={record.snippetStart ?? undefined}
          />
        )}
      />
      <Table.Column<DisplayFinding>
        title=""
        width={140}
        render={(_, record) => (
          <Space size={4}>
            {record.autoFix ? (
              <Tooltip title={t('autofixTooltip')}>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  loading={fixing === record.id}
                  onClick={() => onApply(record)}
                />
              </Tooltip>
            ) : (
              <Tooltip title={t('fixWithAi')}>
                <Button
                  size="small"
                  icon={<RobotOutlined />}
                  loading={fixing === record.id}
                  onClick={() => onFix(record)}
                />
              </Tooltip>
            )}
            <Tooltip title={t('ignoreTooltip')}>
              <Button size="small" onClick={() => onIgnore(record)}>
                {t('ignore')}
              </Button>
            </Tooltip>
          </Space>
        )}
      />
    </Table>
  );
}

interface FindingGroup {
  key: string;
  label: string;
  findings: DisplayFinding[];
}

/** Groupes triés par gravité puis par volume : le plus urgent en haut. */
interface GroupLabels {
  rule: (code: string) => string;
  noNode: string;
}

function buildGroups(findings: DisplayFinding[], groupBy: GroupBy, labels: GroupLabels): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const { key, label } = groupKey(finding, groupBy, labels);
    if (!groups.has(key)) groups.set(key, { key, label, findings: [] });
    groups.get(key)!.findings.push(finding);
  }
  return [...groups.values()].sort((a, b) => {
    const rank = worstSeverity(a.findings) - worstSeverity(b.findings);
    return rank !== 0 ? rank : b.findings.length - a.findings.length;
  });
}

function groupKey(
  finding: DisplayFinding,
  groupBy: GroupBy,
  labels: GroupLabels,
): { key: string; label: string } {
  if (groupBy === 'rule')
    return { key: `${finding.module}|${finding.code}`, label: labels.rule(finding.code) };
  if (groupBy === 'module') return { key: finding.module, label: finding.module };
  return finding.nodeName
    ? { key: `node|${finding.nodeName}`, label: finding.nodeName }
    : { key: 'node|', label: labels.noNode };
}

function worstSeverity(findings: DisplayFinding[]): number {
  return Math.min(...findings.map((finding) => SEVERITY_RANK[finding.severity] ?? 3));
}
