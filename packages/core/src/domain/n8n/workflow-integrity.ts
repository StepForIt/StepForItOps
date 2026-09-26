/**
 * Ce qui empêche un workflow candidat de TOURNER, par opposition à ce qui lui
 * vaut des remarques.
 *
 * La distinction est celle qu'on nous a demandée : on accepte de pousser un
 * workflow non vérifié — findings connus, assumés, contournés à la main — mais
 * jamais un workflow cassé. Un seul verdict pour les deux laissait la case
 * « appliquer quand même » désarmer aussi les atteintes ci-dessous, qui ne sont
 * pas un avis mais un constat : n8n ne saura rien exécuter de ça.
 *
 * Comparatif comme la porte : on ne reproche que ce que la modification
 * INTRODUIT, sinon un workflow déjà amputé de son déclencheur interdirait toute
 * modification, y compris celle qui vient le réparer.
 */

import { msg } from '../../i18n';
import { hasTrigger } from './workflow-graph';
import { N8nWorkflow } from './workflow.types';

/** Une atteinte à l'intégrité : jamais contournable, même par `force`. */
export interface IntegrityBreach {
  code: 'no-nodes' | 'trigger-lost' | 'node-untyped' | 'dangling-connection';
  message: string;
}

/** Noms cités par les connexions mais absents du graphe. */
function danglingNames(workflow: N8nWorkflow): Set<string> {
  const known = new Set((workflow.nodes ?? []).map((node) => node.name));
  const dangling = new Set<string>();
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    if (!known.has(from)) dangling.add(from);
    for (const outputs of Object.values(byType)) {
      for (const targets of outputs) {
        for (const target of targets ?? []) if (!known.has(target.node)) dangling.add(target.node);
      }
    }
  }
  return dangling;
}

/** Nœuds auxquels il manque le strict minimum pour que n8n sache quoi en faire. */
function untypedNames(workflow: N8nWorkflow): Set<string> {
  const untyped = new Set<string>();
  for (const node of workflow.nodes ?? []) {
    if (!node?.name?.trim() || !node?.type?.trim())
      untyped.add(node?.name?.trim() || msg('edit.unnamedNode'));
  }
  return untyped;
}

export function checkWorkflowIntegrity(before: N8nWorkflow, after: N8nWorkflow): IntegrityBreach[] {
  const breaches: IntegrityBreach[] = [];

  if ((before.nodes ?? []).length > 0 && (after.nodes ?? []).length === 0) {
    breaches.push({
      code: 'no-nodes',
      message: msg('edit.breachNoNodes'),
    });
  }

  if (hasTrigger(before) && !hasTrigger(after)) {
    breaches.push({
      code: 'trigger-lost',
      message: msg('edit.breachTriggerLost'),
    });
  }

  const untyped = [...untypedNames(after)].filter((name) => !untypedNames(before).has(name));
  if (untyped.length > 0) {
    breaches.push({
      code: 'node-untyped',
      message: msg('edit.breachUntyped', { names: untyped.join(', ') }),
    });
  }

  const inherited = danglingNames(before);
  const introduced = [...danglingNames(after)].filter((name) => !inherited.has(name));
  if (introduced.length > 0) {
    breaches.push({
      code: 'dangling-connection',
      message: msg('edit.breachDangling', { names: introduced.join(', ') }),
    });
  }

  return breaches;
}
