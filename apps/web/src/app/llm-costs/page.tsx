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
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { AiCostSummary, LlmSampleResult, ModelCost, SilentWorkflow, formatTokens, formatUsd } from './types';
import { WorkflowCostTable } from './workflow-cost-table';
import { CostDailyChart } from './cost-daily-chart';
import { ModelPricesModal } from './model-prices-modal';

const PERIODS = [
  { label: '7 jours', value: 7 },
  { label: '30 jours', value: 30 },
  { label: '90 jours', value: 90 },
];

/**
 * Coûts IA : ce que coûtent les workflows qui appellent un LLM, extrait des
 * exécutions (tokens des sub-nodes Chat Model), valorisé par la table de tarifs.
 * Découpages : total, par jour, par workflow (drill-down par exécution), par modèle.
 */
export default function LlmCostsPage() {
  const { scope } = useInstanceScope();
  const [days, setDays] = usePersistedState('days', 7, {
    validate: (value) => PERIODS.find((period) => period.value === value)?.value,
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
      message.success(budget ? `Alerte au-delà de ${budget} $ / jour.` : 'Alerte de budget désactivée.');
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
          `${result.calls} appel(s) LLM extraits de ${result.executions} exécution(s) sur ${result.instances} instance(s).`,
        );
      } else {
        // Un zéro sans explication se lit « la plateforme ne voit rien ». On dit
        // donc OÙ la chaîne s'est arrêtée : aucun workflow qui parle à un modèle,
        // aucune exécution nouvelle, ou des exécutions sans consommation lisible.
        message.warning(
          result.candidateWorkflows === 0
            ? 'Aucun workflow ne semble appeler un modèle (nœud LLM, nœud vendeur ou HTTP vers un provider).'
            : result.inspectedExecutions === 0
              ? `${result.candidateWorkflows} workflow(s) candidat(s), mais aucune exécution terminée à inspecter — n8n enregistre-t-il les exécutions ?`
              : `${result.inspectedExecutions} exécution(s) inspectée(s) sans consommation lisible — détail des workflows concernés sur la page.`,
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
      title="Coûts IA"
      extra={
        <Space wrap>
          <Segmented options={PERIODS} value={days} onChange={(value) => setDays(value as number)} />
          <Button icon={<SettingOutlined />} onClick={() => setPricesOpen(true)}>
            Tarifs
          </Button>
          <Tooltip title={budget ? `Alerte au-delà de ${budget} $ / jour` : 'Aucune alerte de budget'}>
            <Button icon={<AlertOutlined />} onClick={() => setBudgetOpen(true)}>
              Budget
            </Button>
          </Tooltip>
          <Tooltip title="Auto toutes les 5 min — forcer maintenant">
            <Button icon={<ThunderboltOutlined />} loading={sampling} onClick={sampleNow}>
              Rafraîchir les coûts
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Space>
      }
    >
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {totals && totals.unknownModels.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`${totals.unknownModels.length} modèle(s) sans tarif : ${totals.unknownModels.join(', ')}`}
            description="Totaux = planchers. Ajoutez le tarif puis « Valoriser les appels sans tarif »."
            action={
              <Button size="small" onClick={() => setPricesOpen(true)}>
                Ajouter le tarif
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
            message={`${silent.length} workflow(s) appellent un modèle sans qu'on puisse lire la consommation`}
            description={
              <Space direction="vertical" size={8}>
                {silent.map((w) => (
                  <div key={w.id}>
                    <Link href={`/workflows/show/${w.id}`}>{w.name}</Link>{' '}
                    <Typography.Text type="secondary">
                      ({w.instanceName}, {w.inspectedExecutions} exécution(s) inspectée(s))
                    </Typography.Text>
                    <br />
                    {w.simplifiedNodes.length > 0 ? (
                      <Typography.Text>
                        Nœud(s) <b>{w.simplifiedNodes.join(', ')}</b> : « Simplify Output » est activé (défaut
                        n8n) et retire le compte de tokens de la sortie. Correctif : ouvrir le nœud → Options
                        / champ « Simplify Output » → le désactiver, puis relancer une exécution.
                      </Typography.Text>
                    ) : (
                      <Typography.Text>
                        Aucun réglage fautif identifié sur {w.watchedNodes.join(', ') || 'ses nœuds'} :
                        vérifier que la sortie du nœud contient bien un champ <code>usage</code> (ouvrir une
                        exécution récente dans n8n), et que l'exécution est enregistrée avec ses données.
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
                title="Coût total"
                value={formatUsd(totalCost)}
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
                title="Tokens"
                value={formatTokens((totals?.promptTokens ?? 0) + (totals?.completionTokens ?? 0))}
              />
              <Typography.Text type="secondary">
                {formatTokens(totals?.promptTokens ?? 0)} in / {formatTokens(totals?.completionTokens ?? 0)}{' '}
                out
              </Typography.Text>
              {totals && totals.estimatedShare > 0 && (
                <Tooltip title="Tokens estimés faute de chiffres du provider">
                  <Typography.Text type="secondary" style={{ cursor: 'help' }}>
                    {' '}
                    · {Math.round(totals.estimatedShare * 100)} % estimés
                  </Typography.Text>
                </Tooltip>
              )}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="Appels LLM" value={totals?.calls ?? 0} />
              <Typography.Text type="secondary">
                {totals?.executions ?? 0} exécution(s)
                {totals && totals.executions > 0 && ` · ${formatUsd(totalCost / totals.executions)} / exéc.`}
              </Typography.Text>
            </Card>
          </Col>
        </Row>

        <Card size="small" title="Tendance quotidienne">
          <CostDailyChart daily={summary?.daily ?? []} />
        </Card>

        <Card
          size="small"
          title="Par workflow"
          extra={
            <Space wrap>
              <Segmented
                value={grouped ? 'grouped' : 'flat'}
                onChange={(value) => setGrouped(value === 'grouped')}
                options={[
                  { value: 'grouped', label: 'Groupés par env' },
                  { value: 'flat', label: 'Par workflow n8n' },
                ]}
              />
              <Input.Search
                placeholder="Rechercher un workflow…"
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

        <Card size="small" title="Par modèle">
          <Table<ModelCost>
            rowKey="model"
            dataSource={summary?.models ?? []}
            loading={loading}
            size="small"
            pagination={false}
            scroll={{ x: true }}
            columns={[
              {
                title: 'Modèle',
                dataIndex: 'model',
                render: (model: string) => <Tag>{model}</Tag>,
              },
              { title: 'Appels', dataIndex: 'calls', align: 'right', width: 90 },
              {
                title: 'Tokens in / out',
                align: 'right',
                width: 160,
                render: (_, row) =>
                  `${formatTokens(row.promptTokens)} / ${formatTokens(row.completionTokens)}`,
              },
              {
                title: 'Coût',
                dataIndex: 'costUsd',
                align: 'right',
                width: 120,
                render: (cost: number | null) => formatUsd(cost),
              },
              {
                title: '% du total',
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
        title="Budget quotidien"
        open={budgetOpen}
        onOk={saveBudget}
        confirmLoading={savingBudget}
        onCancel={() => setBudgetOpen(false)}
        okText="Enregistrer"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>Alerte une fois par jour au-delà du seuil. Vide = désactivée.</Typography.Text>
          <InputNumber
            min={0}
            step={0.5}
            placeholder="—"
            value={budget}
            onChange={setBudget}
            addonAfter="$ / jour"
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
