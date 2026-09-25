/**
 * Signature d'une erreur d'exécution n8n : le message est normalisé (parties
 * variables remplacées par des jetons) avant hachage, et le pattern sert de
 * libellé du groupe. Regroupement volontairement par workflow ET par nœud : la
 * même erreur Airtable sur deux workflows reste deux problèmes à traiter.
 */

export interface ErrorOccurrenceLike {
  externalWorkflowId: string;
  failedNode?: string | null;
  message?: string | null;
}

export interface ErrorSignature {
  /** Clé stable — unique par (workflow, nœud, forme du message). */
  key: string;
  /** Message débarrassé de ses parties variables : le libellé du groupe. */
  pattern: string;
}

/** Libellé des erreurs dont n8n ne nous donne (plus) aucun détail. */
export const NO_DETAIL_PATTERN = '(sans détail)';

const MAX_PATTERN = 300;

/**
 * Remplacements appliqués dans l'ordre : chaque règle doit passer avant celles
 * qui pourraient manger une partie de ce qu'elle reconnaît (une url contient des
 * nombres, un uuid contient de l'hexadécimal…).
 */
const RULES: Array<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/https?:\/\/\S+/gi, '<url>'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>'],
  [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, '<date>'],
  // Identifiants n8n / Airtable / Notion : un mot long qui mélange lettres et chiffres.
  [/\b(?=[A-Za-z0-9_]{12,}\b)(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]+\b/g, '<id>'],
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\b\d+(?:[.,]\d+)?\b/g, '<n>'],
];

/** Message d'erreur ramené à sa forme : c'est lui qui décide du regroupement. */
export function normalizeErrorMessage(message: string): string {
  let text = message;
  for (const [pattern, placeholder] of RULES) text = text.replace(pattern, placeholder);
  text = text.replace(/\s+/g, ' ').trim();
  return text.length <= MAX_PATTERN ? text : `${text.slice(0, MAX_PATTERN - 1)}…`;
}

export function errorSignature(occurrence: ErrorOccurrenceLike): ErrorSignature {
  const node = occurrence.failedNode?.trim() || '';
  const message = occurrence.message?.trim() || '';
  // Sans message ni nœud, il ne reste que « ce workflow a cassé » : on regroupe
  // tout ça ensemble plutôt que de créer un groupe par exécution purgée.
  const pattern = message ? normalizeErrorMessage(message) : NO_DETAIL_PATTERN;
  const key = `${occurrence.externalWorkflowId}|${node || '-'}|${hash(pattern)}`;
  return { key, pattern };
}

/** FNV-1a 32 bits : court, déterministe, et sans dépendance (le domaine reste pur). */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}
