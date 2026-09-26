'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';

interface Lesson {
  id: string;
  content: string;
  nodeTypes: string[];
  status: 'candidate' | 'active' | 'retired';
  occurrences: number;
  recalls: number;
  lastRecallAt: string | null;
  origin: 'human-answer' | 'human-correction' | 'gate-refusal';
  originWorkflowId: string | null;
  confirmedBy: string | null;
  createdAt: string;
}

interface Correction {
  id: string;
  workflowId: string;
  status: 'pending' | 'answered' | 'resolved';
  question: string | null;
  answer: string | null;
  createdAt: string;
}

/** D'où vient une leçon, et donc ce qu'elle vaut : c'est la première chose à lire. */
// Libellé et aide : `misc.assistantLessons.origins.<clé>`.
const ORIGINS: Record<
  Lesson['origin'],
  { key: 'humanAnswer' | 'humanCorrection' | 'gateRefusal'; color: string }
> = {
  'human-answer': { key: 'humanAnswer', color: 'green' },
  'human-correction': { key: 'humanCorrection', color: 'blue' },
  'gate-refusal': { key: 'gateRefusal', color: 'blue' },
};

// Libellé : `misc.assistantLessons.statuses.<statut>`.
const STATUSES: Record<Lesson['status'], { color: string }> = {
  active: { color: 'green' },
  candidate: { color: 'orange' },
  retired: { color: 'default' },
};

/**
 * Ce que l'assistant a appris, relu et corrigé par un humain.
 *
 * La page n'est pas un tableau de bord : c'est le garde-fou du dispositif. Une
 * leçon fausse est servie à tous les tours avec le même aplomb qu'une vraie, et
 * rien dans une conversation ne dit d'où elle vient — sans cet écran, la seule
 * façon de la corriger serait le SQL.
 */
export default function AssistantLessons() {
  const t = useTranslations('misc.assistantLessons');
  const tc = useTranslations('common');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = usePersistedState('status', 'all');
  /**
   * L'appel a échoué. Distingué du corpus vide, qui a exactement le même rendu :
   * un module désactivé ou une API muette affichaient « rien encore appris », et
   * on en concluait que l'assistant n'apprenait pas — alors qu'on ne lui avait
   * simplement pas demandé.
   */
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setFailed(null);
    Promise.all([
      apiGet<Lesson[]>('/assistant-learning/lessons'),
      apiGet<Correction[]>('/assistant-learning/corrections'),
    ])
      .then(([gotLessons, gotCorrections]) => {
        setLessons(gotLessons);
        setCorrections(gotCorrections);
      })
      .catch((error) => setFailed((error as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const setStatus = async (lesson: Lesson, status: Lesson['status']) => {
    try {
      await apiPatch(`/assistant-learning/lessons/${lesson.id}`, { status });
      message.success(status === 'active' ? t('toast.activated') : t('toast.retired'));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const saveContent = async (lesson: Lesson) => {
    const content = editing[lesson.id]?.trim();
    if (!content || content === lesson.content) {
      setEditing((previous) => ({ ...previous, [lesson.id]: '' }));
      return;
    }
    try {
      await apiPatch(`/assistant-learning/lessons/${lesson.id}`, { content });
      message.success(t('toast.reworded'));
      setEditing((previous) => ({ ...previous, [lesson.id]: '' }));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiDelete(`/assistant-learning/lessons/${id}`);
      message.success(t('toast.deleted'));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const answer = async (correction: Correction) => {
    const text = answers[correction.id]?.trim();
    if (!text) return;
    try {
      const result = await apiPost<{ learned: string | null }>(
        `/assistant-learning/corrections/${correction.id}/answer`,
        { answer: text },
      );
      message.success(
        result.learned ? t('toast.learned', { rule: result.learned }) : t('toast.nothingToLearn'),
      );
      setAnswers((previous) => ({ ...previous, [correction.id]: '' }));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const dismiss = async (correction: Correction) => {
    try {
      await apiPost(`/assistant-learning/corrections/${correction.id}/dismiss`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const pending = useMemo(
    () => corrections.filter((correction) => correction.status === 'pending' && correction.question),
    [corrections],
  );
  const filtered = useMemo(
    () => (statusFilter === 'all' ? lessons : lessons.filter((lesson) => lesson.status === statusFilter)),
    [lessons, statusFilter],
  );
  const counts = useMemo(
    () => ({
      active: lessons.filter((lesson) => lesson.status === 'active').length,
      candidate: lessons.filter((lesson) => lesson.status === 'candidate').length,
    }),
    [lessons],
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {pending.length > 0 && (
        <Card title={t('pending.title', { count: pending.length })}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            {t('pending.intro')}
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            {pending.map((correction) => (
              <Card key={correction.id} size="small" type="inner" title={correction.question}>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder={t('pending.placeholder')}
                    value={answers[correction.id] ?? ''}
                    onChange={(event) =>
                      setAnswers((previous) => ({ ...previous, [correction.id]: event.target.value }))
                    }
                    onPressEnter={() => answer(correction)}
                  />
                  <Button type="primary" onClick={() => answer(correction)}>
                    {t('pending.answer')}
                  </Button>
                  <Button onClick={() => dismiss(correction)}>{t('pending.skip')}</Button>
                </Space.Compact>
              </Card>
            ))}
          </Space>
        </Card>
      )}

      <Card title={t('learned.title')} extra={<Button onClick={load}>{tc('refresh')}</Button>}>
        {failed && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('failed.title')}
            description={t('failed.body', { error: failed })}
          />
        )}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('budget.title')}
          description={t('budget.body', { active: counts.active, candidate: counts.candidate })}
        />
        <Space style={{ marginBottom: 16 }}>
          <Segmented
            value={statusFilter}
            onChange={(value) => setStatusFilter(String(value))}
            options={[
              { label: t('filter.all'), value: 'all' },
              { label: t('filter.active'), value: 'active' },
              { label: t('filter.candidate'), value: 'candidate' },
              { label: t('filter.retired'), value: 'retired' },
            ]}
          />
        </Space>
        <Table
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: <Empty description={failed ? t('empty.failed') : t('empty.none')} />,
          }}
        >
          <Table.Column<Lesson>
            dataIndex="content"
            title={t('columns.rule')}
            render={(content: string, lesson) =>
              editing[lesson.id] !== undefined && editing[lesson.id] !== '' ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input.TextArea
                    autoSize
                    value={editing[lesson.id]}
                    onChange={(event) =>
                      setEditing((previous) => ({ ...previous, [lesson.id]: event.target.value }))
                    }
                  />
                  <Button type="primary" onClick={() => saveContent(lesson)}>
                    {tc('save')}
                  </Button>
                </Space.Compact>
              ) : (
                <Typography.Text
                  style={{ cursor: 'text' }}
                  onClick={() => setEditing((previous) => ({ ...previous, [lesson.id]: content }))}
                >
                  {content}
                </Typography.Text>
              )
            }
          />
          <Table.Column<Lesson>
            dataIndex="nodeTypes"
            title={t('columns.scope')}
            width={220}
            render={(types: string[]) =>
              types.length === 0 ? (
                <Tooltip title={t('generalHelp')}>
                  <Tag>{t('general')}</Tag>
                </Tooltip>
              ) : (
                <Space size={[0, 4]} wrap>
                  {types.map((type) => (
                    <Tag key={type}>{type.replace(/^n8n-nodes-base\./, '')}</Tag>
                  ))}
                </Space>
              )
            }
          />
          <Table.Column<Lesson>
            dataIndex="origin"
            title={t('columns.source')}
            width={170}
            render={(origin: Lesson['origin']) => (
              <Tooltip title={t(`origins.${ORIGINS[origin].key}.help`)}>
                <Tag color={ORIGINS[origin].color}>{t(`origins.${ORIGINS[origin].key}.label`)}</Tag>
              </Tooltip>
            )}
          />
          <Table.Column<Lesson>
            dataIndex="status"
            title={t('columns.status')}
            width={130}
            render={(status: Lesson['status'], lesson) => (
              <Tooltip title={t('seen', { occurrences: lesson.occurrences, recalls: lesson.recalls })}>
                <Tag color={STATUSES[status].color}>{t(`statuses.${status}`)}</Tag>
              </Tooltip>
            )}
          />
          <Table.Column<Lesson>
            title={tc('columns.actions')}
            width={200}
            render={(_, lesson) => (
              <Space>
                {lesson.status !== 'active' && (
                  <Button size="small" onClick={() => setStatus(lesson, 'active')}>
                    {t('activate')}
                  </Button>
                )}
                {lesson.status === 'active' && (
                  <Button size="small" onClick={() => setStatus(lesson, 'retired')}>
                    {t('retire')}
                  </Button>
                )}
                <Popconfirm
                  title={t('deleteConfirm.title')}
                  description={t('deleteConfirm.body')}
                  onConfirm={() => remove(lesson.id)}
                >
                  <Button size="small" danger>
                    {tc('delete')}
                  </Button>
                </Popconfirm>
              </Space>
            )}
          />
        </Table>
      </Card>
    </Space>
  );
}
