'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ApiOutlined, PlayCircleOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';
import { runWithConcurrency } from '../../lib/concurrency';
import { useInstanceScope } from '../../lib/instance-scope';
import { ListEmptyState } from '../../components/empty-state/list-empty-state';

type Level = 'auth' | 'quota';
type Verdict = 'ok' | 'rejected' | 'no-credit' | 'rate-limited' | 'unreachable' | 'unknown';

interface CheckableCredential {
  credentialId: string;
  type: string;
  name?: string;
  provider: string;
  usedBy: number;
  quotaCheck: boolean;
  /** Dernier passage connu, automatique ou manuel. */
  last?: { verdict: Verdict; level: Level; detail?: string; checkedAt: string };
}

interface CheckResult {
  credentialId: string;
  level: Level;
  verdict: Verdict;
  status?: number;
  detail?: string;
  checkedAt: string;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  ok: 'success',
  rejected: 'error',
  'no-credit': 'error',
  'rate-limited': 'warning',
  unreachable: 'default',
  unknown: 'default',
};

/** Noms de marque : identiques dans toutes les langues. */
const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  mistral: 'Mistral',
  perplexity: 'Perplexity',
};

/** Les tests partent un par un : chacun crée puis supprime un workflow temporaire chez le client. */
const CONCURRENCY = 2;

/**
 * « Mes clés IA marchent-elles encore ? » — la panne que n8n n'annonce pas : une clé
 * révoquée ou un compte à sec ne se voit qu'à la prochaine exécution, chez le client.
 */
export default function CredentialCheckPage() {
  const t = useTranslations('health.credentialCheck');
  const locale = useLocale();
  const { scope, instances, ready } = useInstanceScope();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CheckableCredential[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Le filtre d'instance de la console fait foi ; sans lui, la première instance.
  const current = instanceId ?? scope ?? instances[0]?.id ?? null;

  const load = useCallback(() => {
    if (!current) return;
    setLoading(true);
    apiGet<CheckableCredential[]>(`/credential-check/credentials?instanceId=${current}`)
      .then((rows) => {
        setCredentials(rows);
        // Le dernier passage connu (cron compris) : la page ne repart pas d'un écran « jamais testée ».
        setResults(
          Object.fromEntries(
            rows
              .filter((row) => row.last)
              .map((row) => [row.credentialId, { credentialId: row.credentialId, ...row.last! }]),
          ),
        );
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [current]);

  useEffect(load, [load]);

  const check = useCallback(
    async (credentialId: string, level: Level) => {
      if (!current) return;
      setRunning((prev) => new Set(prev).add(credentialId));
      try {
        const result = await apiPost<CheckResult>('/credential-check/run', {
          instanceId: current,
          credentialId,
          level,
        });
        setResults((prev) => ({ ...prev, [credentialId]: result }));
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(credentialId);
          return next;
        });
      }
    },
    [current],
  );

  const checkAll = () =>
    runWithConcurrency(credentials, CONCURRENCY, (credential) => check(credential.credentialId, 'auth'));

  const problems = useMemo(
    () =>
      Object.values(results).filter(
        (result) => result.verdict === 'rejected' || result.verdict === 'no-credit',
      ).length,
    [results],
  );

  if (!ready) return null;

  return (
    <Card
      title={t('title')}
      extra={
        <Space wrap>
          <Select
            style={{ minWidth: 200 }}
            value={current}
            onChange={setInstanceId}
            options={instances.map((instance) => ({ value: instance.id, label: instance.name }))}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={credentials.length === 0}
            loading={running.size > 0}
            onClick={checkAll}
          >
            {t('checkAll')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {t('intro')} <Link href="/modules">{t('settingsLink')}</Link>
      </Typography.Paragraph>
      {problems > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('problems', { count: problems })}
        />
      )}
      <Table<CheckableCredential>
        rowKey="credentialId"
        size="small"
        loading={loading}
        dataSource={credentials}
        pagination={false}
        locale={{
          emptyText: (
            <ListEmptyState
              needsInstances
              idle={{ title: t('empty.title'), text: t('empty.text'), actions: null }}
            />
          ),
        }}
      >
        <Table.Column<CheckableCredential>
          title={t('columns.credential')}
          render={(_, record) => (
            <Space direction="vertical" size={0}>
              <strong>{record.name ?? record.credentialId}</strong>
              <Typography.Text type="secondary">
                {PROVIDER_NAMES[record.provider] ?? record.provider} · {t('usedBy', { count: record.usedBy })}
              </Typography.Text>
            </Space>
          )}
        />
        <Table.Column<CheckableCredential>
          title={t('columns.state')}
          render={(_, record) => {
            const result = results[record.credentialId];
            if (!result) return <Typography.Text type="secondary">{t('notTested')}</Typography.Text>;
            return (
              <Space direction="vertical" size={0}>
                <Tooltip title={result.detail}>
                  <Tag color={VERDICT_COLOR[result.verdict]}>{t(`verdicts.${result.verdict}`)}</Tag>
                </Tooltip>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`levelDone.${result.level}`)} ·{' '}
                  {t('lastChecked', { date: new Date(result.checkedAt).toLocaleString(locale) })}
                </Typography.Text>
              </Space>
            );
          }}
        />
        <Table.Column<CheckableCredential>
          title=""
          width={300}
          render={(_, record) => (
            <Space wrap>
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={running.has(record.credentialId)}
                onClick={() => check(record.credentialId, 'auth')}
              >
                {t('test')}
              </Button>
              {record.quotaCheck && (
                <Popconfirm
                  title={t('quotaConfirm')}
                  okText={t('quotaOk')}
                  onConfirm={() => check(record.credentialId, 'quota')}
                >
                  <Button size="small" loading={running.has(record.credentialId)}>
                    {t('testCredit')}
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )}
        />
      </Table>
    </Card>
  );
}
