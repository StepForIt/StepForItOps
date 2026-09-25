/** Types miroir des DTO du module performance. */

export interface WorkflowPerfSummary {
  instanceId: string;
  externalWorkflowId: string;
  workflowId: string | null;
  name: string;
  executions: number;
  errors: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  driftRatio: number | null;
  drifted: boolean;
  lastAt: string | null;
}

export interface PerfSummary {
  days: number;
  from: string;
  to: string;
  workflows: WorkflowPerfSummary[];
}

export interface PerfTrendBucket {
  date: string;
  executions: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface PerfTrend {
  externalWorkflowId: string;
  days: number;
  buckets: PerfTrendBucket[];
}

export interface SampleResult {
  instances: number;
  inserted: number;
}

/** 850 ms / 2,3 s / 1 min 12 s : les durées se lisent, elles ne se comptent pas. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
