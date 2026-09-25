import { N8nNode } from './workflow.types';

/**
 * Où un point d'entrée (webhook, formulaire, chat) range le chemin de son URL.
 *
 * n8n le résout par `$parameter["path"] || $parameter["options"]?.path || $webhookId` :
 * le Form Trigger le porte au premier niveau jusqu'à la 2.1, dans ses options à partir
 * de la 2.2 — où il devient facultatif, l'URL retombant alors sur `/form/<webhookId>`.
 * Cet identifiant, l'éditeur ne le laisse plus modifier : c'est à l'écriture du nœud
 * qu'il faut le choisir. Lire le seul `parameters.path` rendait ces formulaires
 * invisibles à tout ce qui aligne ou compare les URLs.
 */

const WEBHOOK_TYPE = 'n8n-nodes-base.webhook';
const FORM_TRIGGER_TYPE = 'n8n-nodes-base.formTrigger';

/** Un nœud porteur d'un `webhookId` expose une URL, quel que soit son type. */
export function hasEntryUrl(node: N8nNode): boolean {
  return node.type === WEBHOOK_TYPE || node.webhookId !== undefined;
}

/**
 * Le nœud sait-il porter un path à lui ? Le Webhook et le Form Trigger oui ; le Chat
 * Trigger et les triggers d'applications n'ont que leur `webhookId`.
 */
export function acceptsDeclaredPath(node: N8nNode): boolean {
  return node.type === WEBHOOK_TYPE || node.type === FORM_TRIGGER_TYPE;
}

function pathInOptions(node: N8nNode): boolean {
  return node.type === FORM_TRIGGER_TYPE && (node.typeVersion ?? 1) >= 2.2;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Le chemin que le nœud déclare lui-même, là où SA version le lit ; sinon `undefined`. */
export function declaredEntryPath(node: N8nNode): string | undefined {
  const holder = pathInOptions(node) ? asRecord(node.parameters?.['options']) : node.parameters;
  const path = holder?.['path'];
  return typeof path === 'string' && path.trim() ? path : undefined;
}

/**
 * Le chemin réellement servi, sans slash de bord. Le nœud Webhook n'a pas de repli :
 * sans path il n'expose rien d'appelable.
 */
export function entryUrlPath(node: N8nNode): string | undefined {
  const value = declaredEntryPath(node) ?? (node.type === WEBHOOK_TYPE ? undefined : node.webhookId);
  return value ? value.replace(/^\/+|\/+$/g, '') : undefined;
}

/** Écrit (ou retire, avec `undefined`) le chemin déclaré, là où la version du nœud le lit. */
export function withDeclaredEntryPath(node: N8nNode, path: string | undefined): N8nNode {
  const parameters = { ...(node.parameters ?? {}) };
  if (pathInOptions(node)) {
    const options = { ...(asRecord(parameters['options']) ?? {}) };
    if (path === undefined) delete options['path'];
    else options['path'] = path;
    parameters['options'] = options;
  } else if (path === undefined) {
    delete parameters['path'];
  } else {
    parameters['path'] = path;
  }
  return { ...node, parameters };
}
