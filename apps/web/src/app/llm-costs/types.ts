/** Types miroir des DTO du module ai-cost. */

export interface AiCostTotals {
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  executions: number;
  estimatedShare: number;
  unpricedShare: number;
  unknownModels: string[];
}

export interface WorkflowCost {
  instanceId: string;
  externalWorkflowId: string;
  workflowId: string | null;
  name: string;
  env: string | null;
  calls: number;
  executions: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedCalls: number;
  lastAt: string | null;
}

/** Le même workflow métier, ses environnements dessous : leurs coûts cumulés. */
export interface WorkflowCostFamily {
  id: string;
  name: string;
  envs: string[];
  unknownEnvCount: number;
  memberCount: number;
  calls: number;
  executions: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedCalls: number;
  lastAt: string | null;
  members: WorkflowCost[];
}

export interface ModelCost {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export interface DailyCost {
  date: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
}

export interface AiCostSummary {
  days: number;
  from: string;
  to: string;
  totals: AiCostTotals;
  workflows: WorkflowCost[];
  families: WorkflowCostFamily[];
  models: ModelCost[];
  daily: DailyCost[];
}

export interface ExecutionCost {
  executionId: string;
  startedAt: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedCalls: number;
  models: string[];
}

export interface LlmSampleResult {
  instances: number;
  executions: number;
  calls: number;
  /** De quoi lire un zéro : où la chaîne s'est arrêtée (cf. `llm-usage-sampler.service.ts`). */
  candidateWorkflows: number;
  inspectedExecutions: number;
  silentWorkflows: SilentWorkflow[];
}

/** Workflow dont les exécutions inspectées n'ont rendu aucune consommation. */
export interface SilentWorkflow {
  id: string;
  name: string;
  instanceName: string;
  inspectedExecutions: number;
  simplifiedNodes: string[];
  watchedNodes: string[];
}

export interface ModelPriceRow {
  id: string;
  pattern: string;
  inputPerMTok: number;
  outputPerMTok: number;
  source: 'seed' | 'custom';
}

/** 0,0042 $ se lit mieux que 4.2e-3 ; au-delà du dollar, deux décimales suffisent. */
export function formatUsd(value: number | null, locale: string): string {
  if (value === null) return '—';
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  const amount = value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return locale.startsWith('fr') ? `${amount} $` : `$${amount}`;
}

/** 1 234 / 45,6 k / 12,3 M : les tokens se comparent à l'ordre de grandeur. */
export function formatTokens(value: number, locale: string): string {
  if (value < 10_000) return value.toLocaleString(locale);
  if (value < 1_000_000) return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} k`;
  return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })} M`;
}
