export type ResourceAccess = 'read' | 'write' | 'delete' | 'other';
export type ColumnImpact = 'to-update' | 'no-action' | 'unknown';
/** Une table se raisonne colonne par colonne ; une API externe, route par route. */
export type ResourceKind = 'table' | 'api';

export interface ResourceSummary {
  key: string;
  label: string;
  provider: string;
  kind: ResourceKind;
  containerKey: string;
  containerLabel: string;
  itemLabel?: string;
  workflowCount: number;
  nodeCount: number;
  dynamic: boolean;
  aliased: boolean;
  terms: string[];
}

export interface ResourceNodeUsage {
  resourceKey: string;
  workflowId: string;
  workflowName: string;
  instanceId: string;
  nodeName: string;
  nodeType: string;
  access: ResourceAccess;
  operation: string;
  fields?: string[];
  matchingColumns?: string[];
  knownColumns?: Array<{ name: string; required: boolean; readOnly: boolean; mapped: boolean }>;
  requiredNotMapped: string[];
  dynamicTable: boolean;
  disabled: boolean;
  understood: boolean;
  impact?: ColumnImpact;
  impactReason?: string;
}

export interface ResourceCall {
  workflowId: string;
  workflowName: string;
  instanceId: string;
  nodeName: string;
  nodeType: string;
  disabled: boolean;
  url?: string;
  method?: string;
}

export interface ResourceUsageResult {
  resource: { key: string; label: string; provider: string; kind: ResourceKind } | null;
  column?: string;
  knownColumns: string[];
  usages: ResourceNodeUsage[];
  calls: ResourceCall[];
}
