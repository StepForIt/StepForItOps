import { DeployKeyContext, deployForm } from './deploy-key';
import { WorkflowDiff, diffWorkflows } from './workflow-diff';
import { N8nWorkflow } from './workflow.types';

export interface DeploySide {
  workflow: N8nWorkflow;
  /** Contexte de SON instance : un sous-workflow se nomme par l'instance qui le porte. */
  context?: DeployKeyContext;
}

/**
 * Ce qui sépare deux exemplaires au sens de `deployKey` : le diff de leurs formes
 * normalisées, donc ni le nom, ni les ids mappés, ni les paths de webhook — seulement
 * ce qu'une promotion de `candidate` sur `reference` changerait.
 *
 * Lu dans le sens de la promotion : `reference` est l'état actuel de la cible,
 * `candidate` ce qu'elle deviendrait. Une ligne retirée est donc ce que la cible
 * PERDRAIT — c'est là qu'un correctif fait en prod se voit.
 */
export function deployDiff(reference: DeploySide, candidate: DeploySide): WorkflowDiff {
  return diffWorkflows(
    deployForm(reference.workflow, reference.context),
    deployForm(candidate.workflow, candidate.context),
  );
}
