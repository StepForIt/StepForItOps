/** Les formes servies par `/impact-study` (module API `impact-study`). */

export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';

export interface WorkflowRef {
  id: string;
  name: string;
  env: string | null;
  instanceName: string;
}

export interface WorkflowImpact {
  level: ImpactLevel;
  score: number;
  reasons: string[];
  safeguards: string[];
  workflow: WorkflowRef & { active: boolean; url: string; platform: 'n8n' | 'make' };
  facts: {
    executions30d: number;
    failures30d: number;
    callers: number;
    publicEntryPoints: number;
    openErrors: number;
    unmappedResources: number;
  };
  callers: WorkflowRef[];
  callees: WorkflowRef[];
  entryPoints: Array<{ kind: string; label: string }>;
  resources: Array<{ key: string; provider: string; label: string; mapped: boolean }>;
  lastExecutionAt: string | null;
  partial: boolean;
}

export interface ImpactSummary {
  count: number;
  byLevel: Record<ImpactLevel, number>;
  highest: ImpactLevel;
  executions30d: number;
  externalCallers: number;
  resources: number;
}

export interface ImpactStudy {
  items: WorkflowImpact[];
  summary: ImpactSummary;
  windowDays: number;
}

export interface ProcedureImpactStudy {
  procedure: { id: string; name: string };
  hop: { source: string; target: string } | null;
  targets: Array<{
    familyKey: string;
    familyName: string;
    env: string;
    role: 'write' | 'run' | 'read';
    stepPositions: number[];
    impact: WorkflowImpact | null;
    note?: string;
  }>;
  summary: ImpactSummary;
  windowDays: number;
}

export const LEVEL_ORDER: ImpactLevel[] = ['critical', 'high', 'medium', 'low'];
