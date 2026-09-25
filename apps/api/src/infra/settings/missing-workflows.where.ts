import { Prisma } from '@prisma/client';

/**
 * Condition DB « workflow que n8n ne connaît plus » : la resynchro a reçu un 404
 * (workflow supprimé côté n8n). La ligne locale est gardée pour son historique.
 */
export const MISSING_WORKFLOW_WHERE: Prisma.WorkflowWhereInput = {
  missingUpstreamAt: { not: null },
};
