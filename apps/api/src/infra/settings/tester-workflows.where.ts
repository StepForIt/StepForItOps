import { Prisma } from '@prisma/client';
import { STUB_PREFIX, STUB_TAG, TEST_COPY_TAG } from '@nwm/core';

/**
 * Condition DB « workflow de travail du module tester » : les bouchons de
 * sous-workflow (`[BOUCHON]`) et les copies bouchonnées (`[TEST]`). La synchro
 * les ramène du miroir comme n'importe quel workflow, et sans exclusion ils
 * atterrissent dans les listes, la couverture d'analyse, les findings et les
 * versions — du bruit qui grandit à chaque essai.
 *
 * Pas de réglage pour les réafficher, comme pour les bancs d'essai : un
 * archivé est un workflow qu'on a rangé, ceux-ci sont des outils. Ils se
 * retrouvent dans n8n, où le test les a posés.
 *
 * Les deux ne s'attrapent pas de la même façon. Le bouchon est reconnu à son
 * tag OU à son préfixe, parce que la plateforme retrouve déjà un bouchon
 * existant par son nom pour le réutiliser. La copie, elle, ne compte que sur
 * son tag : « [TEST] Facturation » est aussi un nom qu'un humain pose à la
 * main, et l'exclure sur ce seul mot cacherait un vrai workflow.
 */
export const TESTER_WORKFLOW_WHERE: Prisma.WorkflowWhereInput = {
  OR: [{ tags: { has: TEST_COPY_TAG } }, { tags: { has: STUB_TAG } }, { name: { startsWith: STUB_PREFIX } }],
};
