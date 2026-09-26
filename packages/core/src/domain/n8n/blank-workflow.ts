import { msg } from '../../i18n';
import { N8nWorkflow } from './workflow.types';

export const MANUAL_TRIGGER_TYPE = 'n8n-nodes-base.manualTrigger';

/** Nom du déclencheur posé à la création (celui que n8n donne lui-même à ce nœud). */
export function blankTriggerName(): string {
  return msg('platform.blankTriggerName');
}

/**
 * Workflow neuf : un déclencheur manuel, et rien d'autre.
 *
 * Un nœud plutôt que zéro : le déclencheur donne un point d'ancrage aux
 * opérations d'édition (`add-node` avec `after`), et un workflow ouvert dans
 * n8n sans aucun nœud n'offre rien à quoi rattacher la suite. Il se remplace en
 * une opération si le vrai déclencheur est un webhook ou une planification.
 */
export function buildBlankWorkflow(name: string): N8nWorkflow {
  return {
    name,
    active: false,
    nodes: [
      {
        name: blankTriggerName(),
        type: MANUAL_TRIGGER_TYPE,
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
    settings: {},
  };
}

/**
 * Workflow encore à construire : le déclencheur de création seul, rien de branché.
 * L'assistant s'en sert pour ouvrir sur « que doit faire ce workflow ? » au lieu
 * d'attendre une question sur un contenu qui n'existe pas.
 */
export function isBlankWorkflow(workflow: N8nWorkflow): boolean {
  const nodes = workflow.nodes ?? [];
  if (Object.keys(workflow.connections ?? {}).length > 0) return false;
  return nodes.length === 0 || (nodes.length === 1 && nodes[0].type === MANUAL_TRIGGER_TYPE);
}
