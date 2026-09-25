'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Input,
  List,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  EyeInvisibleOutlined,
  ExportOutlined,
  MessageOutlined,
  RedoOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost } from '../../lib/api';
import { useWorkflowChat } from '../../components/workflow-chat-drawer';
import type { ErrorGroupDetail, ErrorGroupRow } from './types';
import { CATEGORY_META } from './types';
import { EVENT_META, STATUS_META, formatDate } from './error-group-status';

interface Props {
  /** Groupe cliqué (sert d'affichage immédiat pendant le chargement du détail). */
  group: ErrorGroupRow | null;
  onClose: () => void;
  /** Appelé après une action pour rafraîchir la liste derrière le tiroir. */
  onChanged: () => void;
}

/**
 * Détail d'un problème : ce qui casse, combien de fois, et surtout son historique
 * — quand il a été traité, et s'il est revenu depuis.
 */
export function ErrorGroupDrawer({ group, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ErrorGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const chat = useWorkflowChat();

  /** IA erreur → correctif : crée la conversation pré-alimentée puis ouvre le chat. */
  const proposeFix = async () => {
    if (!current?.workflowId) return;
    setFixing(true);
    // L'appel dure plusieurs secondes : un bouton qui tourne sans un mot se lit
    // comme une page figée, et on reclique.
    const done = message.loading('L’IA rédige un correctif pour ce problème…', 0);
    try {
      const result = await apiPost<{ workflowId: string; sessionId: string; proposalId: string | null }>(
        `/workflow-chat/error-fix/${current.id}`,
      );
      message.success(
        result.proposalId
          ? 'Correctif proposé — relis le diff avant d’appliquer.'
          : 'L’IA a répondu sans proposer de modification — sa réponse est dans le chat.',
      );
      // Le chat s'ouvre par-dessus : changer de page pour lire un diff faisait
      // perdre le problème en cours de lecture.
      chat.open({ workflowId: result.workflowId, sessionId: result.sessionId, onWorkflowChanged: onChanged });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setFixing(false);
      done();
    }
  };

  const load = useCallback((id: string) => {
    setLoading(true);
    setError(undefined);
    apiGet<ErrorGroupDetail>(`/error-groups/${id}`)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setDetail(null);
    setNote('');
    if (group) load(group.id);
  }, [group, load]);

  const act = async (action: 'resolve' | 'reopen' | 'ignore' | 'note', label: string) => {
    if (!group) return;
    if (action === 'note' && !note.trim()) {
      message.warning('Écris la note avant de l’ajouter.');
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/error-groups/${group.id}/${action}`, { note: note.trim() || undefined });
      message.success(label);
      setNote('');
      load(group.id);
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = detail ?? group;

  return (
    <Drawer
      open={group !== null}
      onClose={onClose}
      width={760}
      title={current ? `Problème — ${current.workflowName}` : 'Problème'}
      extra={
        current && (
          <Space>
            {current.category !== 'other' && (
              <Tag color={(CATEGORY_META[current.category] ?? CATEGORY_META.other).color}>
                {(CATEGORY_META[current.category] ?? CATEGORY_META.other).label}
              </Tag>
            )}
            <Tag color={STATUS_META[current.status].color}>{STATUS_META[current.status].label}</Tag>
            {current.regressions > 0 && (
              <Tag color="volcano" icon={<RedoOutlined />}>
                {current.regressions} rechute{current.regressions > 1 ? 's' : ''}
              </Tag>
            )}
          </Space>
        )
      }
    >
      {current && (
        <>
          {current.status === 'resolved' && (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              Traité le {formatDate(current.resolvedAt)}
              {current.resolvedBy ? ` par ${current.resolvedBy}` : ''}
              {current.resolutionNote && (
                <>
                  <br />
                  {current.resolutionNote}
                </>
              )}
            </Typography.Paragraph>
          )}
          {current.regressions > 0 && current.status === 'open' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Rechute le ${formatDate(current.reopenedAt)}.`}
            />
          )}

          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Nœud fautif">
              {current.failedNode ? (
                <Space direction="vertical" size={2}>
                  <Tag color="red">{current.failedNode}</Tag>
                  {current.failedNodeType && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {current.failedNodeType}
                    </Typography.Text>
                  )}
                </Space>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Occurrences">{current.occurrences}</Descriptions.Item>
            <Descriptions.Item label="Première fois">{formatDate(current.firstSeenAt)}</Descriptions.Item>
            <Descriptions.Item label="Dernière fois">{formatDate(current.lastSeenAt)}</Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5}>Erreur</Typography.Title>
          <Alert type="error" message={current.pattern} style={{ marginBottom: 8 }} />
          {current.sample && current.sample !== current.pattern && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              Dernier message réel : {current.sample}
            </Typography.Paragraph>
          )}

          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input.TextArea
              placeholder="Note (ce qui a été corrigé, pourquoi c’est normal…)"
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Space.Compact>
          <Space wrap style={{ marginTop: 8, marginBottom: 20 }}>
            {current.status !== 'resolved' && (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={busy}
                onClick={() => act('resolve', 'Problème marqué comme traité.')}
              >
                Marquer comme traité
              </Button>
            )}
            {current.status !== 'open' && (
              <Button
                icon={<RedoOutlined />}
                loading={busy}
                onClick={() => act('reopen', 'Problème rouvert.')}
              >
                Rouvrir
              </Button>
            )}
            {current.status !== 'ignored' && (
              <Tooltip title="Erreur connue et acceptée : elle ne remontera plus, même si elle se répète.">
                <Button
                  icon={<EyeInvisibleOutlined />}
                  loading={busy}
                  onClick={() => act('ignore', 'Problème ignoré.')}
                >
                  Ignorer
                </Button>
              </Tooltip>
            )}
            <Button icon={<MessageOutlined />} loading={busy} onClick={() => act('note', 'Note ajoutée.')}>
              Ajouter la note
            </Button>
            {current.workflowId && (
              <Tooltip title="Revu en diff avant application">
                <Button icon={<RobotOutlined />} loading={fixing} onClick={proposeFix}>
                  Proposer un correctif (IA)
                </Button>
              </Tooltip>
            )}
          </Space>

          {error && <Alert type="error" showIcon message="Détail indisponible" description={error} />}
          {loading && !detail && <Skeleton active paragraph={{ rows: 4 }} />}

          {detail && (
            <>
              {detail.events.length > 0 && <Typography.Title level={5}>Historique</Typography.Title>}
              {detail.events.length > 0 && (
                <Timeline
                  style={{ marginTop: 8 }}
                  items={detail.events.map((event) => ({
                    color: EVENT_META[event.type]?.color ?? 'blue',
                    children: (
                      <Space direction="vertical" size={0}>
                        <Space size={8}>
                          <strong>{EVENT_META[event.type]?.label ?? event.type}</strong>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {formatDate(event.createdAt)}
                            {event.author ? ` · ${event.author}` : ''}
                            {event.type === 'regression' &&
                              ` · ${event.occurrences} occurrence(s) à ce moment`}
                          </Typography.Text>
                        </Space>
                        {event.note && <Typography.Text>{event.note}</Typography.Text>}
                      </Space>
                    ),
                  }))}
                />
              )}

              <Typography.Title level={5}>Dernières occurrences</Typography.Title>
              <List
                size="small"
                dataSource={detail.recent}
                renderItem={(row) => (
                  <List.Item
                    actions={[
                      row.n8nUrl ? (
                        <Button
                          key="n8n"
                          size="small"
                          type="text"
                          icon={<ExportOutlined />}
                          href={row.n8nUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        />
                      ) : null,
                    ]}
                  >
                    <Space size={12}>
                      <Typography.Text>{formatDate(row.startedAt)}</Typography.Text>
                      <Typography.Text type="secondary">#{row.executionId}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
