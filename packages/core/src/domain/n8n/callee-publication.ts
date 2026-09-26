import { msg } from '../../i18n';
import { detectPublishModel } from './n8n-publish-model';
import { SubWorkflowRef, extractSubWorkflowRefs } from './sub-workflow-refs';
import { N8nWorkflow } from './workflow.types';
import { TriggerKind, isTriggerNode, triggerKindOf } from './workflow-graph';

/**
 * Sur un n8n à versions, publier un workflow exige que chaque sous-workflow qu'il
 * appelle soit PUBLIÉ (`workflow-validation.service.ts` : « Please publish all
 * referenced sub-workflows first »). Or la promotion crée ses sous-workflows en
 * cascade à l'état de brouillon : le workflow promu devenait impossible à activer,
 * et une prod déjà publiée refusait jusqu'à l'écriture, qui la republie.
 *
 * On ne publie de soi-même que ce qui ne peut RIEN démarrer seul : un workflow dont
 * les déclencheurs sont l'appel par un autre workflow (et, au plus, le bouton
 * manuel). Un webhook ou une planification le mettraient en route ; celui-là reste
 * à l'humain, avec ses appelants.
 */

export interface CalleePublication {
  /** À publier dans cet ordre : les plus profonds d'abord, puisque n8n valide les appelés de chacun. */
  publish: Array<{ id: string; name: string }>;
  /** En brouillon, mais pas à nous de le publier : la raison le dit. */
  manual: Array<{ id: string; name: string; reason: string }>;
}

const SILENT_TRIGGERS: readonly TriggerKind[] = ['sub-workflow', 'manual'];

/** Mêmes appels que ceux que n8n contrôle : `executeWorkflow` actif, id fixe, lu en base. */
function checkedCalleeRefs(workflow: N8nWorkflow): SubWorkflowRef[] {
  const nodes = new Map((workflow.nodes ?? []).map((node) => [node.name, node]));
  return extractSubWorkflowRefs(workflow).filter((ref) => {
    const source = nodes.get(ref.nodeName)?.parameters?.['source'];
    return (
      ref.kind === 'execute' &&
      !ref.disabled &&
      !ref.dynamic &&
      (source === undefined || source === 'database')
    );
  });
}

export function checkedCallees(workflow: N8nWorkflow): string[] {
  return checkedCalleeRefs(workflow).map((ref) => ref.externalId);
}

/**
 * Apparie les appelés d'un workflow source à ceux de son exemplaire promu, par le
 * NŒUD qui appelle : la promotion ne réécrit que l'id, jamais le nom du nœud. Un
 * appel sans contrepartie côté cible rend `undefined`.
 */
export function pairCallees(
  source: N8nWorkflow,
  target: N8nWorkflow | undefined,
): Array<{ source: string; target?: string }> {
  const targetByNode = new Map(
    (target ? checkedCalleeRefs(target) : []).map((ref) => [ref.nodeName, ref.externalId]),
  );
  return checkedCalleeRefs(source).map((ref) => ({
    source: ref.externalId,
    target: targetByNode.get(ref.nodeName),
  }));
}

/** Le déclencheur qui le ferait tourner seul une fois publié, s'il en a un. */
function selfStartingTrigger(workflow: N8nWorkflow): TriggerKind | null {
  const kinds = (workflow.nodes ?? [])
    .filter((node) => !node.disabled && isTriggerNode(node))
    .map((node) => triggerKindOf(node));
  return kinds.find((kind) => !SILENT_TRIGGERS.includes(kind)) ?? null;
}

/**
 * Ce qu'il faut publier pour que `root` puisse l'être. `lookup` rend un workflow de
 * l'instance cible par son id n8n, tel que n8n le sert (c'est `activeVersionId` qui
 * dit s'il est publié) ; un id inconnu est ignoré.
 */
export function planCalleePublication(
  root: N8nWorkflow,
  lookup: (id: string) => N8nWorkflow | undefined,
): CalleePublication {
  const plan: CalleePublication = { publish: [], manual: [] };
  const visited = new Set<string>(root.id !== undefined ? [String(root.id)] : []);
  const blocked = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const workflow = lookup(id);
    // Déjà publié, ou n8n sans publication par versions : rien à faire, et n8n a
    // validé ses appelés quand il l'a été.
    if (!workflow || detectPublishModel(workflow) !== 'versioned-unpublished') return;

    const callees = checkedCallees(workflow);
    callees.forEach(visit);
    const name = workflow.name;
    const stuck = callees.filter((callee) => blocked.has(callee)).map((callee) => lookup(callee)?.name);
    const trigger = selfStartingTrigger(workflow);
    const reason = workflow.isArchived
      ? msg('env.calleeArchived')
      : trigger
        ? msg('env.calleeSelfStarting', { trigger })
        : stuck.length > 0
          ? msg('env.calleeStuck', {
              names: stuck.map((n) => msg('env.quoted', { name: n ?? '' })).join(', '),
            })
          : null;
    if (reason) {
      blocked.add(id);
      plan.manual.push({ id, name, reason });
    } else {
      plan.publish.push({ id, name });
    }
  };

  checkedCallees(root).forEach(visit);
  return plan;
}
