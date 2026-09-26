/** Types partagés par la page Erreurs et ses graphes (miroir des DTO du module monitoring). */

export interface ExecutionErrorRow {
  id: string;
  instanceId: string;
  executionId: string;
  externalWorkflowId: string;
  workflowId: string | null;
  workflowName: string;
  startedAt: string;
  stoppedAt: string | null;
  mode: string | null;
  detailState: 'pending' | 'fetched' | 'unavailable';
  failedNode: string | null;
  failedNodeType: string | null;
  message: string | null;
  stack: string | null;
  groupId: string | null;
  n8nUrl: string | null;
}

export type ErrorGroupStatus = 'open' | 'resolved' | 'ignored';

export type ErrorCategory = 'auth' | 'rate-limit' | 'timeout' | 'network' | 'data' | 'other';

/** Couleur antd de chaque catégorie, pour les tags et le filtre (libellé : `health.errors.category.<code>`). */
export const CATEGORY_META: Record<ErrorCategory, { color: string }> = {
  auth: { color: 'purple' },
  'rate-limit': { color: 'gold' },
  timeout: { color: 'orange' },
  network: { color: 'cyan' },
  data: { color: 'magenta' },
  other: { color: 'default' },
};

/** Un problème : toutes les occurrences d'une même erreur, sur un même workflow. */
export interface ErrorGroupRow {
  id: string;
  instanceId: string;
  signature: string;
  externalWorkflowId: string;
  workflowId: string | null;
  workflowName: string;
  failedNode: string | null;
  failedNodeType: string | null;
  /** Message normalisé (ids, dates et nombres remplacés) : le libellé du groupe. */
  pattern: string;
  /** Dernier message réel, qui illustre le pattern. */
  sample: string | null;
  /** Genre de problème, déduit du message : auth, rate-limit, timeout, network, data, other. */
  category: ErrorCategory;
  status: ErrorGroupStatus;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  reopenedAt: string | null;
  /** Nombre de rechutes : le problème est revenu après avoir été marqué traité. */
  regressions: number;
}

export interface ErrorGroupEventRow {
  id: string;
  type: 'resolved' | 'reopened' | 'regression' | 'ignored' | 'note';
  note: string | null;
  author: string | null;
  occurrences: number;
  createdAt: string;
}

export interface ErrorGroupDetail extends ErrorGroupRow {
  events: ErrorGroupEventRow[];
  recent: ExecutionErrorRow[];
}

export interface RegroupResult {
  processed: number;
  groups: number;
  remaining: number;
}

export interface ErrorStatsBucket {
  date: string;
  total: number;
  byWorkflow: Record<string, number>;
}

export interface ErrorStatsWorkflow {
  externalWorkflowId: string;
  workflowId: string | null;
  name: string;
  total: number;
  lastAt: string;
}

export interface ErrorStats {
  days: number;
  from: string;
  to: string;
  total: number;
  truncated: boolean;
  pendingDetails: number;
  openGroups: number;
  ungrouped: number;
  buckets: ErrorStatsBucket[];
  workflows: ErrorStatsWorkflow[];
}

export interface BackfillResult {
  scanned: number;
  imported: number;
  alreadyKnown: number;
  oldest?: string;
}
