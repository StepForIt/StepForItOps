export interface ModelParcRow {
  model: string;
  provider: string | null;
  status: string | null;
  retiresAt: string | null;
  replacedByPattern: string | null;
  tier: string | null;
  known: boolean;
  nodes: number;
  workflows: number;
  costUsd30d: number;
  calls30d: number;
  tasks: Record<string, number>;
  workflowNames: string[];
}

export interface ModelParcSummary {
  models: ModelParcRow[];
  freshness: {
    checkedAt: string | null;
    ageDays: number | null;
    stale: boolean;
    staleAfterDays: number;
  };
}

export interface AuditRunResult {
  workflows: number;
  skipped: number;
  findings: number;
  catalogStale: boolean;
  catalogAgeDays: number | null;
}

export interface CatalogProposal {
  id: string;
  pattern: string;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  origin: string;
  evidence: string | null;
}

export interface TaskProfile {
  task: string;
  label: string;
  minTier: string;
}
