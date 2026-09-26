/**
 * « J'ajoute une colonne à cette table — quels nœuds rouvrir ? » : seul compte
 * un nœud qui fige une liste de champs, celui qui lit tout ou mappe
 * automatiquement suit l'ajout tout seul. Rien de spécifique à un provider :
 * on ne lit que les deux formes standardisées par n8n — le `resourceMapper`
 * (`mappingMode` + `value` + `schema[]`, photo des colonnes au moment du
 * réglage : `required`, `readOnly`, `removed`) et les paires
 * `fieldsUi.fieldValues[]` des nœuds plus anciens. Fail-safe : une écriture
 * d'une forme inconnue ressort `understood: false`, jamais « sans action ».
 */

import { msg } from '../../i18n';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { activeParameters } from './inert-params';
import { extractNodeResourceRefs } from './resource-refs';

/** Sens de l'accès, déduit de l'opération n8n. */
export type ResourceAccess = 'read' | 'write' | 'delete' | 'other';

/** Colonne telle que n8n la connaissait au moment où le nœud a été réglé. */
export interface KnownColumn {
  name: string;
  required: boolean;
  readOnly: boolean;
  /** false = colonne connue mais écartée du mapping (`removed`). */
  mapped: boolean;
}

/** Ce qu'un nœud fait des champs d'une ressource. */
export interface ResourceFieldUsage {
  /** Même clé que `ResourceRef` (ex. `airtable:appXXX/tblYYY`). */
  resourceKey: string;
  nodeName: string;
  nodeType: string;
  access: ResourceAccess;
  /** Opération n8n brute (`search`, `update`, `getAll`…), `''` si le nœud n'en déclare pas. */
  operation: string;
  /** Liste explicite des champs. `undefined` = le nœud n'en fige aucune. */
  fields?: string[];
  /** Colonnes de rapprochement d'un update / upsert. */
  matchingColumns?: string[];
  /** `undefined` quand le nœud ne garde pas trace des colonnes de la table. */
  knownColumns?: KnownColumn[];
  /** La table est désignée par une expression : le rattachement reste indicatif. */
  dynamicTable: boolean;
  /** Nœud désactivé dans n8n. */
  disabled: boolean;
  /** false = forme de nœud non reconnue, verdict impossible. */
  understood: boolean;
}

/** Verdict d'un nœud face à l'ajout d'une colonne. */
export type ColumnImpact = 'to-update' | 'no-action' | 'unknown';

export interface ColumnVerdict {
  impact: ColumnImpact;
  reason: string;
}

type Params = Record<string, unknown>;

/** Providers qui désignent une table et donc portent des champs. */
const TABLE_PROVIDERS = new Set(['airtable', 'google-sheets', 'notion', 'nocodb', 'postgres']);

function isObject(value: unknown): value is Params {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

/**
 * Premier `resourceMapper` rencontré, à n'importe quelle profondeur : le
 * paramètre ne s'appelle pas `columns` partout (`fieldsToSend`, `dataMode`…),
 * on le reconnaît donc à sa forme comme le fait `inert-params`.
 */
function findResourceMapper(value: unknown): Params | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResourceMapper(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  if (typeof value.mappingMode === 'string' && ('value' in value || Array.isArray(value.schema))) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findResourceMapper(child);
    if (found) return found;
  }
  return undefined;
}

/** Premier `fieldValues[]` (paires `fieldName` / `fieldValue`) rencontré. */
function findFieldValues(value: unknown): Params[] | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFieldValues(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const candidate = value.fieldValues;
  if (Array.isArray(candidate) && candidate.every((item) => isObject(item) && 'fieldName' in item)) {
    return candidate as Params[];
  }
  for (const child of Object.values(value)) {
    const found = findFieldValues(child);
    if (found) return found;
  }
  return undefined;
}

function toKnownColumns(schema: unknown): KnownColumn[] | undefined {
  if (!Array.isArray(schema) || schema.length === 0) return undefined;
  const columns = schema.filter(isObject).map((entry) => ({
    name: String(entry.displayName ?? entry.id ?? ''),
    required: entry.required === true,
    readOnly: entry.readOnly === true,
    // `removed` absent = colonne mappée (n8n n'écrit le booléen que s'il est vrai)
    mapped: entry.removed !== true,
  }));
  const named = columns.filter((column) => column.name.length > 0);
  return named.length > 0 ? named : undefined;
}

/** Champs sélectionnés en lecture, quand le nœud en propose une liste. */
function selectedFields(params: Params): string[] | undefined {
  const options = params.options;
  const fromOptions = isObject(options) ? stringArray(options.fields) : undefined;
  return fromOptions ?? stringArray(params.fields) ?? stringArray(params.columns);
}

/**
 * Interrupteur « j'écris tout ce que je reçois » des nœuds sans
 * `resourceMapper` — `dataToSend: autoMapInputData` chez NocoDB. Il n'y a alors
 * aucune liste de champs à tenir à jour, et c'est une absence VOULUE : à ne pas
 * confondre avec un nœud qu'on n'a pas su lire.
 */
function autoMapsInput(params: Params): boolean {
  return ['dataToSend', 'mappingMode'].some(
    (key) => typeof params[key] === 'string' && /auto/i.test(params[key] as string),
  );
}

const ACCESS_RULES: Array<[RegExp, ResourceAccess]> = [
  [/^(create|append|insert|upsert|update|write|add)/i, 'write'],
  [/^(get|read|search|list|find|lookup|select)/i, 'read'],
  [/^(delete|remove|clear|truncate)/i, 'delete'],
];

function accessOf(operation: string, writesFields: boolean): ResourceAccess {
  for (const [pattern, access] of ACCESS_RULES) {
    if (pattern.test(operation)) return access;
  }
  // Beaucoup de nœuds omettent l'opération par défaut (un « Get a record »
  // Airtable n'a pas de clé `operation`) : la présence d'un mapping tranche.
  if (operation.length === 0) return writesFields ? 'write' : 'read';
  return 'other';
}

function usageFromNode(node: N8nNode, resourceKey: string): ResourceFieldUsage {
  const params = activeParameters(node);
  const mapper = findResourceMapper(params);
  const fieldValues = mapper ? undefined : findFieldValues(params);
  const operation = typeof params.operation === 'string' ? params.operation : '';
  const access = accessOf(operation, Boolean(mapper ?? fieldValues));

  const base = {
    resourceKey,
    nodeName: node.name,
    nodeType: node.type,
    operation,
    // La clé porte l'expression telle quelle quand la table est dynamique.
    dynamicTable: resourceKey.includes('{{'),
    disabled: node.disabled === true,
  };

  if (access === 'read' || access === 'delete' || access === 'other') {
    return { ...base, access, fields: selectedFields(params), understood: true };
  }

  if (mapper) {
    // `activeParameters` a déjà retiré `value` hors mode `defineBelow` : pas de
    // liste figée dans ce cas, donc rien à mettre à jour.
    const values = isObject(mapper.value) ? Object.keys(mapper.value) : undefined;
    return {
      ...base,
      access,
      fields: values && values.length > 0 ? values : undefined,
      matchingColumns: stringArray(mapper.matchingColumns),
      knownColumns: toKnownColumns(mapper.schema),
      understood: true,
    };
  }

  if (fieldValues) {
    const names = fieldValues
      .map((entry) => (typeof entry.fieldName === 'string' ? entry.fieldName : ''))
      .filter((name) => name.length > 0);
    return { ...base, access, fields: names.length > 0 ? names : undefined, understood: true };
  }

  if (autoMapsInput(params)) return { ...base, access, understood: true };

  return { ...base, access, understood: false };
}

/** Ce que chaque nœud du workflow fait des champs des tables qu'il touche. */
export function extractResourceFieldUsages(workflow: N8nWorkflow): ResourceFieldUsage[] {
  return workflow.nodes.flatMap((node) =>
    extractNodeResourceRefs(node)
      .filter((ref) => TABLE_PROVIDERS.has(ref.provider))
      .map((ref) => usageFromNode(node, ref.key)),
  );
}

function sameColumn(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Ce que l'ajout de `column` impose à ce nœud. */
export function columnImpact(usage: ResourceFieldUsage, column: string): ColumnVerdict {
  if (!usage.understood) {
    return { impact: 'unknown', reason: msg('platform.columnUnknownShape') };
  }
  if (usage.access === 'delete' || usage.access === 'other') {
    return { impact: 'no-action', reason: msg('platform.columnNoFields') };
  }
  if (!usage.fields) {
    return usage.access === 'write'
      ? { impact: 'no-action', reason: msg('platform.columnAutoMap') }
      : { impact: 'no-action', reason: msg('platform.columnAllRead') };
  }
  if (usage.fields.some((field) => sameColumn(field, column))) {
    return usage.access === 'write'
      ? { impact: 'no-action', reason: msg('platform.columnAlreadyMapped') }
      : { impact: 'no-action', reason: msg('platform.columnAlreadySelected') };
  }
  const count = usage.fields.length;
  return usage.access === 'write'
    ? {
        impact: 'to-update',
        reason: msg('platform.columnFixedMapping', { count }),
      }
    : {
        impact: 'to-update',
        reason: msg('platform.columnFixedSelection', { count }),
      };
}

/**
 * Colonnes que n8n donnait pour obligatoires et que le nœud n'écrit pas —
 * indépendant de l'ajout en cours, mais c'est le moment de le voir.
 */
export function requiredNotMapped(usage: ResourceFieldUsage): string[] {
  if (usage.access !== 'write' || !usage.knownColumns) return [];
  return usage.knownColumns
    .filter((column) => column.required && !column.readOnly && !column.mapped)
    .map((column) => column.name);
}
