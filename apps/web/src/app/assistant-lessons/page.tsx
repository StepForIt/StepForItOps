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
const ORIGINS: Record<Lesson['origin'], { label: string; color: string; help: string }> = {
  'human-answer': {
    label: 'Réponse humaine',
    color: 'green',
    help: "Quelqu'un a expliqué une correction qu'il avait faite à la main. Le signal le plus fiable.",
  },
  'human-correction': {
    label: 'Correction à la main',
    color: 'blue',
    help: "Déduite d'un écart de FORME entre ce que l'assistant a écrit et ce qui a été laissé.",
  },
  'gate-refusal': {
    label: 'Refus de porte',
    color: 'geekblue',
    help: 'Un contrôle déterministe a refusé un brouillon, que l’assistant a ensuite corrigé.',
  },
};

const STATUSES: Record<Lesson['status'], { label: string; color: string }> = {
  active: { label: 'Servie', color: 'green' },
  candidate: { label: 'En attente', color: 'orange' },
  retired: { label: 'Retirée', color: 'default' },
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
      message.success(status === 'active' ? 'Leçon activée — elle sera servie' : 'Leçon retirée');
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
      message.success('Formulation corrigée');
      setEditing((previous) => ({ ...previous, [lesson.id]: '' }));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiDelete(`/assistant-learning/lessons/${id}`);
      message.success('Leçon supprimée');
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
        result.learned ? `Règle apprise : ${result.learned}` : 'Réponse enregistrée — rien à généraliser',
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
        <Card title={`Corrections inexpliquées (${pending.length})`}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Une modification a été reprise à la main après une proposition de l’assistant, et rien ne dit s’il
            s’était trompé ou si l’intention a changé. Les deux ont exactement la même forme dans le JSON —
            seule une réponse les distingue.
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            {pending.map((correction) => (
              <Card key={correction.id} size="small" type="inner" title={correction.question}>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="Ce qui n’allait pas, en une phrase — ou « rien, j’ai changé d’avis »"
                    value={answers[correction.id] ?? ''}
                    onChange={(event) =>
                      setAnswers((previous) => ({ ...previous, [correction.id]: event.target.value }))
                    }
                    onPressEnter={() => answer(correction)}
                  />
                  <Button type="primary" onClick={() => answer(correction)}>
                    Répondre
                  </Button>
                  <Button onClick={() => dismiss(correction)}>Passer</Button>
                </Space.Compact>
              </Card>
            ))}
          </Space>
        </Card>
      )}

      <Card title="Ce que l’assistant a appris" extra={<Button onClick={load}>Rafraîchir</Button>}>
        {failed && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Leçons illisibles"
            description={
              `${failed} — le module « Assistant auto-apprenant » est peut-être désactivé (page Modules). ` +
              'Ce n’est pas un corpus vide : rien ne peut être affiché tant que cet appel échoue.'
            }
          />
        )}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Six règles au plus atteignent le prompt à chaque tour"
          description={
            `${counts.active} règle(s) servie(s), ${counts.candidate} en attente. Une règle « en attente » ` +
            'vient d’un seul incident et n’est jamais servie : elle s’active à la deuxième occurrence, ' +
            'ou d’un clic ici. Le nombre de règles peut grossir sans coût — c’est le nombre SERVI qui est borné, ' +
            'et il est choisi par type de nœud du workflow puis par les mots de la question.'
          }
        />
        <Space style={{ marginBottom: 16 }}>
          <Segmented
            value={statusFilter}
            onChange={(value) => setStatusFilter(String(value))}
            options={[
              { label: 'Toutes', value: 'all' },
              { label: 'Servies', value: 'active' },
              { label: 'En attente', value: 'candidate' },
              { label: 'Retirées', value: 'retired' },
            ]}
          />
        </Space>
        <Table
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                description={
                  failed
                    ? 'Rien ne peut être affiché : voir l’avertissement ci-dessus.'
                    : 'Rien encore appris — les règles apparaissent quand une proposition de l’assistant est corrigée à la main, ou refusée puis corrigée.'
                }
              />
            ),
          }}
        >
          <Table.Column<Lesson>
            dataIndex="content"
            title="Règle"
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
                    Enregistrer
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
            title="Portée"
            width={220}
            render={(types: string[]) =>
              types.length === 0 ? (
                <Tooltip title="Règle générale : ne remonte que par les mots de la question.">
                  <Tag>générale</Tag>
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
            title="Source"
            width={170}
            render={(origin: Lesson['origin']) => (
              <Tooltip title={ORIGINS[origin].help}>
                <Tag color={ORIGINS[origin].color}>{ORIGINS[origin].label}</Tag>
              </Tooltip>
            )}
          />
          <Table.Column<Lesson>
            dataIndex="status"
            title="État"
            width={130}
            render={(status: Lesson['status'], lesson) => (
              <Tooltip title={`Vue ${lesson.occurrences} fois, servie ${lesson.recalls} fois`}>
                <Tag color={STATUSES[status].color}>{STATUSES[status].label}</Tag>
              </Tooltip>
            )}
          />
          <Table.Column<Lesson>
            title="Actions"
            width={200}
            render={(_, lesson) => (
              <Space>
                {lesson.status !== 'active' && (
                  <Button size="small" onClick={() => setStatus(lesson, 'active')}>
                    Activer
                  </Button>
                )}
                {lesson.status === 'active' && (
                  <Button size="small" onClick={() => setStatus(lesson, 'retired')}>
                    Retirer
                  </Button>
                )}
                <Popconfirm
                  title="Supprimer cette règle ?"
                  description="Elle pourra être réapprise si le cas se reproduit."
                  onConfirm={() => remove(lesson.id)}
                >
                  <Button size="small" danger>
                    Supprimer
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
