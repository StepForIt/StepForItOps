'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Table } from '../../components/resizable-table';
import {
  AlertOutlined,
  DollarOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { AiCostSummary, LlmSampleResult, ModelCost, SilentWorkflow, formatTokens, formatUsd } from './types';
import { WorkflowCostTable } from './workflow-cost-table';
import { CostDailyChart } from './cost-daily-chart';
import { ModelPricesModal } from './model-prices-modal';

const PERIODS = [7, 30, 90];

/**
 * Coûts IA : ce que coûtent les workflows qui appellent un LLM, extrait des
 * exécutions (tokens des sub-nodes Chat Model), valorisé par la table de tarifs.
 * Découpages : total, par jour, par workflow (drill-down par exécution), par modèle.
 */
export default function LlmCostsPage() {
  const { scope } = useInstanceScope();
  const t = useTranslations('health.llmCosts');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [days, setDays] = usePersistedState('days', 7, {
    validate: (value) => PERIODS.find((period) => period === value),
  });
  const [summary, setSummary] = useState<AiCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sampling, setSampling] = useState(false);
  const [silent, setSilent] = useState<SilentWorkflow[]>([]);
  const [search, setSearch] = usePersistedState('search', '');
  // Groupé par défaut, comme les listes Workflows et Versions : la facture d'un
  // workflow métier est celle de tous ses environnements réunis.
  const [grouped, setGrouped] = usePersistedState('grouped', true);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budget, setBudget] = useState<number | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    apiGet<{ dailyBudgetUsd: number | null }>('/ai-cost/budget')
      .then((settings) => setBudget(settings.dailyBudgetUsd))
      .catch(() => undefined);
  }, []);

  const saveBudget = async () => {
    setSavingBudget(true);
    try {
      await apiPut('/ai-cost/budget', { dailyBudgetUsd: budget });
      message.success(budget ? t('page.budgetSaved', { budget }) : t('page.budgetDisabled'));
      setBudgetOpen(false);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSavingBudget(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (scope) params.set('instanceId', scope);
    apiGet<AiCostSummary>(`/ai-cost/summary?${params}`)
      .then(setSummary)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [scope, days]);

  useEffect(load, [load]);

  /** Poll immédiat des instances (sans attendre le passage des 5 min), puis rechargement. */
  const sampleNow = async () => {
    setSampling(true);
    try {
      const result = await apiPost<LlmSampleResult>('/ai-cost/sample');
      setSilent(result.silentWorkflows ?? []);
      if (result.calls > 0) {
        message.success(
          t('page.sampled', {
            calls: result.calls,
            executions: result.executions,
            instances: result.instances,
          }),
        );
      } else {
        // Un zéro sans explication se lit « la plateforme ne voit rien ». On dit
        // donc OÙ la chaîne s'est arrêtée : aucun workflow qui parle à un modèle,
        // aucune exécution nouvelle, ou des exécutions sans consommation lisible.
        message.warning(
          result.candidateWorkflows === 0
            ? t('page.sampleNoCandidate')
            : result.inspectedExecutions === 0
              ? t('page.sampleNoExecution', { count: result.candidateWorkflows })
              : t('page.sampleNoUsage', { count: result.inspectedExecutions }),
          10,
        );
      }
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSampling(false);
    }
  };

  const totals = summary?.totals;
  const totalCost = totals?.costUsd ?? 0;
  const matches = (name: string) => !search || name.toLowerCase().includes(search.toLowerCase());
  const workflows = (summary?.workflows ?? []).filter((row) => matches(row.name));
  // Une famille sort si son nom métier OU l'un de ses exemplaires correspond :
  // chercher « - PROD » ne doit pas rendre le groupe introuvable.
  const families = (summary?.families ?? []).filter(
    (row) => matches(row.name) || row.members.some((m) => matches(m.name)),
  );

  return (
    <Card
      title={t('page.title')}
      extra={
        <Space wrap>
          <Segmented
            options={PERIODS.map((value) => ({ value, label: t('page.periodDays', { days: value }) }))}
            value={days}
            onChange={(value) => setDays(value as number)}
          />
          <Button icon={<SettingOutlined />} onClick={() => setPricesOpen(true)}>
            {t('page.prices')}
          </Button>
          <Tooltip title={budget ? t('page.budgetTooltip', { budget }) : t('page.noBudget')}>
            <Button icon={<AlertOutlined />} onClick={() => setBudgetOpen(true)}>
              {t('page.budget')}
            </Button>
          </Tooltip>
          <Tooltip title={t('page.sampleTooltip')}>
            <Button icon={<ThunderboltOutlined />} loading={sampling} onClick={sampleNow}>
              {t('page.sample')}
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} aria-label={tc('refresh')} />
        </Space>
      }
    >
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {totals && totals.unknownModels.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t('page.unknownModels', {
              count: totals.unknownModels.length,
              models: totals.unknownModels.join(', '),
            })}
            description={t('page.unknownModelsHint')}
            action={
              <Button size="small" onClick={() => setPricesOpen(true)}>
                {t('page.addPrice')}
              </Button>
            }
          />
        )}

        {silent.length > 0 && (
          <Alert
            type="warning"
            showIcon
            closable
            onClose={() => setSilent([])}
            message={t('page.silentTitle', { count: silent.length })}
            description={
              <Space direction="vertical" size={8}>
                {silent.map((w) => (
                  <div key={w.id}>
                    <Link href={`/workflows/show/${w.id}`}>{w.name}</Link>{' '}
                    <Typography.Text type="secondary">
                      {t('page.silentMeta', { instance: w.instanceName, count: w.inspectedExecutions })}
                    </Typography.Text>
                    <br />
                    {w.simplifiedNodes.length > 0 ? (
                      <Typography.Text>
                        {t.rich('page.silentSimplify', {
                          nodes: w.simplifiedNodes.join(', '),
                          b: (chunks) => <b>{chunks}</b>,
                        })}
                      </Typography.Text>
                    ) : (
                      <Typography.Text>
                        {t.rich('page.silentUnknown', {
                          nodes: w.watchedNodes.join(', ') || t('page.itsNodes'),
                          code: (chunks) => <code>{chunks}</code>,
                        })}
                      </Typography.Text>
                    )}
                  </div>
                ))}
              </Space>
            }
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={12} md={8}>
            <Card size="small">
              <Statistic
                title={t('page.totalCost')}
                value={formatUsd(totalCost, locale)}
                prefix={
                  <>
                    <DollarOutlined />
                    {totals && totals.unpricedShare > 0 && ' ≥'}
                  </>
                }
              />
            </Card>
          </Col>
          <Col xs={12} md={8}>
            <Card size="small">
              <Statistic
                title={t('page.tokens')}
                value={formatTokens((totals?.promptTokens ?? 0) + (totals?.completionTokens ?? 0), locale)}
              />
              <Typography.Text type="secondary">
                {t('page.tokensInOut', {
                  tokensIn: formatTokens(totals?.promptTokens ?? 0, locale),
                  tokensOut: formatTokens(totals?.completionTokens ?? 0, locale),
                })}
              </Typography.Text>
              {totals && totals.estimatedShare > 0 && (
                <Tooltip title={t('page.estimatedTooltip')}>
                  <Typography.Text type="secondary" style={{ cursor: 'help' }}>
                    {' '}
                    · {t('page.estimated', { percent: Math.round(totals.estimatedShare * 100) })}
                  </Typography.Text>
                </Tooltip>
              )}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title={t('page.llmCalls')} value={totals?.calls ?? 0} />
              <Typography.Text type="secondary">
                {t('page.executions', { count: totals?.executions ?? 0 })}
                {totals &&
                  totals.executions > 0 &&
                  ` · ${t('page.perExecution', { cost: formatUsd(totalCost / totals.executions, locale) })}`}
              </Typography.Text>
            </Card>
          </Col>
        </Row>

        <Card size="small" title={t('page.dailyTrend')}>
          <CostDailyChart daily={summary?.daily ?? []} />
        </Card>

        <Card
          size="small"
          title={t('page.byWorkflow')}
          extra={
            <Space wrap>
              <Segmented
                value={grouped ? 'grouped' : 'flat'}
                onChange={(value) => setGrouped(value === 'grouped')}
                options={[
                  { value: 'grouped', label: t('page.grouped') },
                  { value: 'flat', label: t('page.flat') },
                ]}
              />
              <Input.Search
                placeholder={t('page.searchPlaceholder')}
                allowClear
                style={{ width: 240 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Space>
          }
        >
          <WorkflowCostTable
            workflows={workflows}
            families={families}
            grouped={grouped}
            days={days}
            loading={loading}
            totalCost={totalCost}
          />
        </Card>

        <Card size="small" title={t('page.byModel')}>
          <Table<ModelCost>
            rowKey="model"
            dataSource={summary?.models ?? []}
            loading={loading}
            size="small"
            pagination={false}
            scroll={{ x: true }}
            columns={[
              {
                title: t('page.model'),
                dataIndex: 'model',
                render: (model: string) => <Tag>{model}</Tag>,
              },
              { title: t('columns.calls'), dataIndex: 'calls', align: 'right', width: 90 },
              {
                key: 'tokens',
                title: t('columns.tokens'),
                align: 'right',
                width: 160,
                render: (_, row) =>
                  `${formatTokens(row.promptTokens, locale)} / ${formatTokens(row.completionTokens, locale)}`,
              },
              {
                title: t('columns.cost'),
                dataIndex: 'costUsd',
                align: 'right',
                width: 120,
                render: (cost: number | null) => formatUsd(cost, locale),
              },
              {
                key: 'totalShare',
                title: t('columns.totalShare'),
                width: 160,
                render: (_, row) => (
                  <Progress
                    percent={
                      totalCost > 0 && row.costUsd !== null ? Math.round((row.costUsd / totalCost) * 100) : 0
                    }
                    size="small"
                  />
                ),
              },
            ]}
          />
        </Card>
      </Space>

      <Modal
        title={t('page.budgetTitle')}
        open={budgetOpen}
        onOk={saveBudget}
        confirmLoading={savingBudget}
        onCancel={() => setBudgetOpen(false)}
        okText={tc('save')}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>{t('page.budgetHint')}</Typography.Text>
          <InputNumber
            min={0}
            step={0.5}
            placeholder="—"
            value={budget}
            onChange={setBudget}
            addonAfter={t('page.perDay')}
            style={{ width: 200 }}
          />
        </Space>
      </Modal>

      <ModelPricesModal
        open={pricesOpen}
        suggestedPattern={totals?.unknownModels[0]}
        onClose={(changed) => {
          setPricesOpen(false);
          if (changed) load();
        }}
      />
    </Card>
  );
}
