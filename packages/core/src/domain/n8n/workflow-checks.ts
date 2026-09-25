/**
 * Tout ce qu'on sait vérifier sur un workflow sans IA ni IO, en un seul appel.
 *
 * Le module `verifier` s'en sert pour son analyse, et la boucle de l'assistant
 * pour se relire AVANT de proposer une modification : c'est la même liste des
 * deux côtés, sinon l'IA validerait sur des règles que l'analyse ne connaît pas.
 */

import { N8nWorkflow } from './workflow.types';
import { CheckFinding, runStructuralChecks } from './structural-checks';
import { runReliabilityChecks } from './reliability-checks';
import { runPlaceholderChecks } from './placeholder-params';
import { runLoopWiringChecks } from './loop-wiring';

export function runWorkflowChecks(workflow: N8nWorkflow): CheckFinding[] {
  return [
    ...runStructuralChecks(workflow),
    ...runReliabilityChecks(workflow),
    ...runPlaceholderChecks(workflow),
    ...runLoopWiringChecks(workflow),
  ];
}
