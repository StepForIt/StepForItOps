/**
 * Le PÉRIMÈTRE d'une conversation : le workflow ouvert, et les sous-workflows
 * qu'il appelle.
 *
 * Un workflow n8n est rarement seul. La pratique de la maison consiste justement
 * à sortir la seconde responsabilité en sous-workflow, si bien que la moitié du
 * comportement vit ailleurs — et l'assistant, scopé sur un seul JSON, expliquait
 * le nœud « Execute Workflow » sans jamais pouvoir dire ce qu'il déclenchait, ni
 * corriger la faute qui était de l'autre côté. Un finding sur l'appelé se
 * corrigeait en rouvrant une seconde conversation, sur un workflow qu'il fallait
 * d'abord retrouver dans la liste.
 *
 * Le périmètre s'ARRÊTE : on suit les appels, jamais les appelants — remonter
 * ferait entrer dans le tour tous les workflows du parc qui passent par un
 * utilitaire commun, pour une demande qui n'en touche aucun.
 */
import { SubWorkflowRefKind, extractSubWorkflowRefs } from './sub-workflow-refs';
import { N8nWorkflow } from './workflow.types';

/**
 * Profondeur suivie depuis la racine. Deux niveaux : l'appelé, et ce que
 * l'appelé appelle. Au-delà, on décrit une chaîne d'orchestration entière pour
 * une demande qui porte sur un nœud, et chaque membre coûte une lecture n8n.
 */
export const SCOPE_MAX_DEPTH = 2;

/**
 * Membres au plus, racine comprise. Un orchestrateur qui aiguille vers quinze
 * sous-workflows remplirait le contexte de noms que personne ne va toucher.
 */
export const SCOPE_MAX_MEMBERS = 8;

/** Un sous-workflow appelé, vu depuis son appelant. */
export interface SubWorkflowCall {
  /** Id n8n écrit dans le paramètre `workflowId`. */
  externalId: string;
  /** Nœuds de l'appelant qui pointent dessus (souvent un seul). */
  nodes: string[];
  /** Nom affiché par n8n (`cachedResultName`), à défaut du nom réel. */
  label?: string;
  kind: SubWorkflowRefKind;
}

/**
 * Les sous-workflows appelés par ce workflow, dédoublonnés par id.
 *
 * Les références DYNAMIQUES sont écartées : un `workflowId` construit par
 * expression ne désigne aucune cible connue à l'avance, et faire entrer dans le
 * périmètre le workflow dont l'id a été deviné serait pire que de n'en faire
 * entrer aucun. Les nœuds désactivés restent : on les réactive un jour, et
 * l'assistant doit pouvoir en parler.
 */
export function subWorkflowCalls(workflow: N8nWorkflow): SubWorkflowCall[] {
  const calls = new Map<string, SubWorkflowCall>();
  for (const ref of extractSubWorkflowRefs(workflow)) {
    if (ref.dynamic) continue;
    const known = calls.get(ref.externalId);
    if (known) {
      known.nodes.push(ref.nodeName);
      continue;
    }
    calls.set(ref.externalId, {
      externalId: ref.externalId,
      nodes: [ref.nodeName],
      ...(ref.label ? { label: ref.label } : {}),
      kind: ref.kind,
    });
  }
  return [...calls.values()];
}

/** Un workflow du périmètre, tel que l'assistant le désigne et le manipule. */
export interface ScopeMember {
  /** Id plateforme : c'est lui qui sert à écrire. */
  workflowId: string;
  externalId: string;
  name: string;
  /** 0 = le workflow de la conversation. */
  depth: number;
  /** Comment on y arrive : `« Appelant » → nœud`. Vide pour la racine. */
  calledBy: string[];
  /** Le workflow vient d'être créé par ce tour, et n'a encore que son déclencheur. */
  created?: boolean;
}

/**
 * Retrouve un membre par ce que le modèle a écrit : son nom exact, son id n8n,
 * ou son id plateforme. Le nom d'abord — c'est ce qu'il a sous les yeux — et la
 * comparaison est insensible à la casse et aux espaces de bord, parce qu'un nom
 * recopié depuis le contexte l'est rarement au caractère près.
 */
export function findScopeMember<T extends ScopeMember>(members: T[], key: string): T | null {
  const wanted = key.trim().toLowerCase();
  if (!wanted) return null;
  return (
    members.find((member) => member.name.trim().toLowerCase() === wanted) ??
    members.find((member) => member.externalId === key.trim() || member.workflowId === key.trim()) ??
    null
  );
}
