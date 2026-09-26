import { msg } from '../../i18n';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { declaredEntryPath } from './entry-path';
import { TriggerKind, isTriggerNode, triggerKindOf } from './workflow-graph';

/**
 * Ce qui met un workflow en route, vu de l'extérieur : une URL publique (webhook,
 * formulaire, chat), une horloge, une application tierce, un humain, un workflow parent.
 * Un workflow a autant de points d'entrée que de triggers actifs — un webhook et un
 * formulaire sur le même workflow sont deux portes, pas une à départager.
 */
export interface WorkflowEntryPoint {
  kind: TriggerKind;
  /** Nœud trigger correspondant, pour retrouver la porte dans n8n. */
  nodeName: string;
  /**
   * Segment d'URL servi par n8n en production (`webhook`, `form`, `chat`) et chemin
   * appelé. Absents quand la porte n'est pas une URL (horloge, appel d'un parent…).
   */
  segment?: string;
  path?: string;
  /** Libellé lisible quand il n'y a pas d'URL à montrer (« planifié », « Telegram »…). */
  label?: string;
}

const URL_SEGMENTS: Partial<Record<TriggerKind, string>> = {
  webhook: 'webhook',
  form: 'form',
  chat: 'chat',
};

/**
 * Nom de l'application derrière un trigger tiers : `n8n-nodes-base.telegramTrigger`
 * → « Telegram ». C'est ce que l'utilisateur lit dans n8n.
 */
function appLabel(node: N8nNode): string {
  const last = node.type.split('.').pop() ?? node.type;
  const name = last.replace(/trigger$/i, '');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : node.type;
}

function entryOf(node: N8nNode): WorkflowEntryPoint | null {
  const kind = triggerKindOf(node);
  const segment = URL_SEGMENTS[kind];
  if (segment) {
    const value = declaredEntryPath(node) ?? node.webhookId;
    // Une URL sans chemin ne s'appelle pas : on retombe sur un libellé.
    if (value) {
      return { kind, nodeName: node.name, segment, path: value.replace(/^\/+|\/+$/g, '') };
    }
  }

  switch (kind) {
    case 'schedule':
      return { kind, nodeName: node.name, label: msg('env.entryScheduled') };
    case 'error':
      return { kind, nodeName: node.name, label: msg('env.entryError') };
    case 'manual':
      return { kind, nodeName: node.name, label: msg('env.entryManual') };
    // Un sous-workflow est déjà montré par les flèches de ses appelants : pas de porte
    // à dessiner, sinon on double l'information sur chaque enfant.
    case 'sub-workflow':
      return null;
    default:
      return { kind, nodeName: node.name, label: appLabel(node) };
  }
}

/** Portes d'entrée d'un workflow, triggers désactivés exclus (ils n'ouvrent rien). */
export function workflowEntryPoints(workflow: N8nWorkflow): WorkflowEntryPoint[] {
  return (workflow.nodes ?? [])
    .filter((node) => !node.disabled && isTriggerNode(node))
    .map(entryOf)
    .filter((entry): entry is WorkflowEntryPoint => entry !== null);
}
