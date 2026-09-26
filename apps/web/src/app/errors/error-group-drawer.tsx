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
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('health.errors');
  const locale = useLocale();
  const fmt = (value: string | null) => formatDate(value, locale);

  /** IA erreur → correctif : crée la conversation pré-alimentée puis ouvre le chat. */
  const proposeFix = async () => {
    if (!current?.workflowId) return;
    setFixing(true);
    // L'appel dure plusieurs secondes : un bouton qui tourne sans un mot se lit
    // comme une page figée, et on reclique.
    const done = message.loading(t('group.fixLoading'), 0);
    try {
      const result = await apiPost<{ workflowId: string; sessionId: string; proposalId: string | null }>(
        `/workflow-chat/error-fix/${current.id}`,
      );
      message.success(result.proposalId ? t('group.fixProposed') : t('group.fixNoProposal'));
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
      message.warning(t('group.noteRequired'));
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
      title={current ? t('group.title', { name: current.workflowName }) : t('group.titleEmpty')}
      extra={
        current && (
          <Space>
            {current.category !== 'other' && (
              <Tag color={(CATEGORY_META[current.category] ?? CATEGORY_META.other).color}>
                {t(`category.${current.category in CATEGORY_META ? current.category : 'other'}`)}
              </Tag>
            )}
            <Tag color={STATUS_META[current.status].color}>{t(`status.${current.status}`)}</Tag>
            {current.regressions > 0 && (
              <Tag color="volcano" icon={<RedoOutlined />}>
                {t('regressions', { count: current.regressions })}
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
              {current.resolvedBy
                ? t('group.resolvedOnBy', { date: fmt(current.resolvedAt), author: current.resolvedBy })
                : t('group.resolvedOn', { date: fmt(current.resolvedAt) })}
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
              message={t('group.regressionOn', { date: fmt(current.reopenedAt) })}
            />
          )}

          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t('group.failedNode')}>
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
            <Descriptions.Item label={t('group.occurrences')}>{current.occurrences}</Descriptions.Item>
            <Descriptions.Item label={t('group.firstSeen')}>{fmt(current.firstSeenAt)}</Descriptions.Item>
            <Descriptions.Item label={t('group.lastSeen')}>{fmt(current.lastSeenAt)}</Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5}>{t('group.error')}</Typography.Title>
          <Alert type="error" message={current.pattern} style={{ marginBottom: 8 }} />
          {current.sample && current.sample !== current.pattern && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('group.lastSample', { sample: current.sample })}
            </Typography.Paragraph>
          )}

          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input.TextArea
              placeholder={t('group.notePlaceholder')}
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
                onClick={() => act('resolve', t('group.resolvedMsg'))}
              >
                {t('group.resolve')}
              </Button>
            )}
            {current.status !== 'open' && (
              <Button
                icon={<RedoOutlined />}
                loading={busy}
                onClick={() => act('reopen', t('group.reopenedMsg'))}
              >
                {t('group.reopen')}
              </Button>
            )}
            {current.status !== 'ignored' && (
              <Tooltip title={t('group.ignoreTooltip')}>
                <Button
                  icon={<EyeInvisibleOutlined />}
                  loading={busy}
                  onClick={() => act('ignore', t('group.ignoredMsg'))}
                >
                  {t('group.ignore')}
                </Button>
              </Tooltip>
            )}
            <Button
              icon={<MessageOutlined />}
              loading={busy}
              onClick={() => act('note', t('group.noteAdded'))}
            >
              {t('group.addNote')}
            </Button>
            {current.workflowId && (
              <Tooltip title={t('group.fixTooltip')}>
                <Button icon={<RobotOutlined />} loading={fixing} onClick={proposeFix}>
                  {t('group.proposeFix')}
                </Button>
              </Tooltip>
            )}
          </Space>

          {error && (
            <Alert type="error" showIcon message={t('group.detailUnavailable')} description={error} />
          )}
          {loading && !detail && <Skeleton active paragraph={{ rows: 4 }} />}

          {detail && (
            <>
              {detail.events.length > 0 && (
                <Typography.Title level={5}>{t('group.history')}</Typography.Title>
              )}
              {detail.events.length > 0 && (
                <Timeline
                  style={{ marginTop: 8 }}
                  items={detail.events.map((event) => ({
                    color: EVENT_META[event.type]?.color ?? 'blue',
                    children: (
                      <Space direction="vertical" size={0}>
                        <Space size={8}>
                          <strong>{event.type in EVENT_META ? t(`event.${event.type}`) : event.type}</strong>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {fmt(event.createdAt)}
                            {event.author ? ` · ${event.author}` : ''}
                            {event.type === 'regression' &&
                              ` · ${t('group.regressionOccurrences', { count: event.occurrences })}`}
                          </Typography.Text>
                        </Space>
                        {event.note && <Typography.Text>{event.note}</Typography.Text>}
                      </Space>
                    ),
                  }))}
                />
              )}

              <Typography.Title level={5}>{t('group.recent')}</Typography.Title>
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
                      <Typography.Text>{fmt(row.startedAt)}</Typography.Text>
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
