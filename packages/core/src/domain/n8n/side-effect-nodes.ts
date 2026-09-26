/**
 * Nœuds qui SORTENT du système : mail parti, message posté, ligne écrite, appel
 * de sous-workflow. Ce sont eux qu'un test doit bouchonner par défaut — un envoi
 * réel pendant un essai ne se rattrape pas, alors qu'un bouchon oublié se voit
 * tout de suite dans le résultat.
 */
import { msg } from '../../i18n';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { activeParameters } from './inert-params';
import { paramString } from './n8n-params';

export type SideEffectKind = 'email' | 'message' | 'http-write' | 'data-write' | 'sub-workflow';

export interface SideEffectNode {
  nodeName: string;
  type: string;
  kind: SideEffectKind;
  /** Ce qui a déclenché le classement, dit en clair pour l'écran de test. */
  reason: string;
}

const EMAIL = [
  'emailsend',
  'gmail',
  'microsoftoutlook',
  'sendgrid',
  'mailgun',
  'mandrill',
  'sendinblue',
  'brevo',
];
const MESSAGE = [
  'slack',
  'telegram',
  'discord',
  'twilio',
  'whatsapp',
  'microsoftteams',
  'mattermost',
  'pushover',
];
/** Opérations qui écrivent, quel que soit le provider (Airtable, NocoDB, Sheets, Notion…). */
const WRITE_OPERATIONS = [
  'create',
  'update',
  'upsert',
  'delete',
  'append',
  'appendorupdate',
  'insert',
  'add',
];
const WRITING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function match(type: string, needles: string[]): boolean {
  return needles.some((needle) => type.includes(needle));
}

function classify(node: N8nNode): { kind: SideEffectKind; reason: string } | null {
  const type = node.type.toLowerCase();
  // Un trigger ne sort rien : il attend. Et le trigger de sous-workflow porte
  // "executeworkflow" dans son type, sans être un appel.
  if (type.endsWith('trigger')) return null;

  if (match(type, EMAIL)) return { kind: 'email', reason: msg('platform.sideEffectEmail') };
  if (match(type, MESSAGE)) return { kind: 'message', reason: msg('platform.sideEffectMessage') };
  if (type.includes('executeworkflow') || type.includes('toolworkflow')) {
    return { kind: 'sub-workflow', reason: msg('platform.sideEffectSubWorkflow') };
  }

  const parameters = activeParameters(node);
  if (type.includes('httprequest')) {
    const method = (paramString(parameters['method']) ?? 'GET').toUpperCase();
    return WRITING_METHODS.includes(method)
      ? { kind: 'http-write', reason: msg('platform.sideEffectHttp', { method }) }
      : null;
  }

  const operation = paramString(parameters['operation'])?.toLowerCase();
  if (operation && WRITE_OPERATIONS.includes(operation)) {
    return { kind: 'data-write', reason: msg('platform.sideEffectDataWrite', { operation }) };
  }
  return null;
}

/**
 * Verdict pour un nœud SEUL, `disabled` non regardé : un banc d'essai exécute
 * exprès un nœud désactivé, et c'est justement là qu'il faut dire ce qui sort.
 */
export function classifySideEffect(node: N8nNode): SideEffectNode | null {
  const verdict = classify(node);
  return verdict ? { nodeName: node.name, type: node.type, ...verdict } : null;
}

export function detectSideEffects(workflow: N8nWorkflow): SideEffectNode[] {
  const found: SideEffectNode[] = [];
  for (const node of workflow.nodes ?? []) {
    if (node.disabled) continue;
    const verdict = classifySideEffect(node);
    if (verdict) found.push(verdict);
  }
  return found;
}
