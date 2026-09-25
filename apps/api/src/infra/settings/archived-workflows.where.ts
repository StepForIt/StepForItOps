import { Prisma } from '@prisma/client';
import { ARCHIVED_PREFIX, ARCHIVED_TAG } from '@nwm/core';

/**
 * Condition DB « workflow archivé » : tag `archived`, nom préfixé `[ARCHIVED]`,
 * ou archivage natif n8n (colonne `archivedUpstream`, alimentée à la synchro).
 */
export const ARCHIVED_WORKFLOW_WHERE: Prisma.WorkflowWhereInput = {
  OR: [
    { tags: { has: ARCHIVED_TAG } },
    { name: { startsWith: ARCHIVED_PREFIX.trimEnd() } },
    { archivedUpstream: true },
  ],
};
