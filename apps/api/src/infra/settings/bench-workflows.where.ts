import { Prisma } from '@prisma/client';
import { BENCH_PREFIX, BENCH_TAG } from '@nwm/core';

/**
 * Condition DB « banc d'essai » : un workflow posé par la plateforme pour
 * exécuter UN nœud isolé. Sans exclusion, chaque banc ramené par la synchro
 * atterrirait dans les listes, la couverture d'analyse, les findings et les
 * versions — du bruit qui grandit à chaque essai.
 *
 * Pas de réglage pour le réafficher, contrairement aux archivés : un banc n'est
 * pas un workflow qu'on a rangé, c'est un outil. Il se retrouve dans n8n, ou
 * par la page des bancs qui les lit là-bas.
 */
export const BENCH_WORKFLOW_WHERE: Prisma.WorkflowWhereInput = {
  OR: [{ tags: { has: BENCH_TAG } }, { name: { startsWith: BENCH_PREFIX } }],
};
