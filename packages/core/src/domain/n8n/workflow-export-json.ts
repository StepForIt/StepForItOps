/**
 * JSON d'un workflow prêt à SORTIR de la plateforme : collé dans une
 * conversation avec une IA, gardé de côté, ou réimporté à la main dans un n8n
 * (« Import from File »).
 *
 * Le JSON brut de l'API n8n ne s'importe pas tel quel : il porte l'identité de
 * l'exemplaire d'origine — `id`, `versionId`, `meta.instanceId`, l'état `active`
 * et les tags avec LEURS ids —, autant de champs qu'une autre instance ne sait
 * pas relire et qui, réimportés, rattachent la copie au workflow source. On ne
 * garde donc que ce qui décrit le travail : nom, nœuds, câblage, réglages.
 *
 * `pinData` est le cas à part : c'est de la donnée d'exécution RÉELLE épinglée
 * dans l'éditeur (un item de production, avec ses adresses et ses montants).
 * Elle est donc exclue par défaut — l'export part souvent chez un tiers — et
 * réintégrée seulement si on la demande, quand le but est de rejouer le
 * workflow ailleurs à l'identique.
 */

import { N8nWorkflow } from './workflow.types';

export interface WorkflowExportOptions {
  /** Rembarque les données épinglées (donnée de production : opt-in explicite). */
  includePinData?: boolean;
}

/** Champs d'identité et d'état retirés de l'export (cf. en-tête). */
const DROPPED_KEYS = [
  'id',
  'active',
  'isArchived',
  'versionId',
  'createdAt',
  'updatedAt',
  'triggerCount',
  'staticData',
  'shared',
  'homeProject',
  'sharedWithProjects',
  'meta',
  'pinData',
  'tags',
] as const;

export function toExportableWorkflow(
  raw: N8nWorkflow,
  options: WorkflowExportOptions = {},
): Record<string, unknown> {
  const source = raw as unknown as Record<string, unknown>;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!(DROPPED_KEYS as readonly string[]).includes(key)) rest[key] = value;
  }
  // Ordre voulu : ce qu'on lit d'abord en ouvrant le fichier.
  const exported: Record<string, unknown> = {
    name: raw.name,
    nodes: raw.nodes ?? [],
    connections: raw.connections ?? {},
    ...rest,
    settings: raw.settings ?? {},
  };
  const tags = exportedTags(raw.tags);
  if (tags.length > 0) exported.tags = tags;
  if (options.includePinData && raw.pinData && Object.keys(raw.pinData).length > 0) {
    exported.pinData = raw.pinData;
  }
  return exported;
}

/**
 * Les tags ne gardent que leur nom : leur id ne vaut que dans l'instance
 * d'origine, et n8n rattache un tag importé par son nom.
 */
function exportedTags(tags: N8nWorkflow['tags']): Array<{ name: string }> {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name }));
}

/** Texte final, indenté : c'est lui qu'on copie et qu'on télécharge, à l'octet près. */
export function workflowExportText(raw: N8nWorkflow, options?: WorkflowExportOptions): string {
  return JSON.stringify(toExportableWorkflow(raw, options), null, 2);
}

/** `Facturation client` → `facturation-client.json` (nom de fichier téléchargé). */
export function workflowExportFileName(workflowName: string): string {
  const slug = workflowName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'workflow'}.json`;
}
