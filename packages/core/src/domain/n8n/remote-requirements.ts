/**
 * « Le distant a-t-il tout ce que ce workflow attend ? » — la moitié statique :
 * pour chaque table touchée (Airtable, NocoDB, Notion, Google Sheets,
 * PostgreSQL), les colonnes qu'un nœud lit ou écrit, et le nœud qui les
 * demande. L'autre moitié — ce que la table porte vraiment — se lit à
 * l'exécution et se confronte ici dans `remote-schema-compare.ts`.
 *
 * Trois sources de colonnes : la liste figée d'un mapping (`resourceMapper`
 * en `defineBelow`, `fieldsUi`, propriétés Notion), la sélection d'une lecture
 * (`options.fields`), et — le cas qui justifie ce fichier — les clés posées par
 * les nœuds Set en amont d'une écriture en « Map Automatically ».
 */

import { N8nNode, N8nWorkflow } from './workflow.types';
import { activeParameters } from './inert-params';
import { paramLabel, paramString } from './n8n-params';
import { extractResourceFieldUsages } from './resource-fields';
import { upstreamKeys } from './upstream-keys';
import { msg } from '../../i18n/translate';

export type RemoteProvider = 'airtable' | 'nocodb' | 'notion' | 'google-sheets' | 'postgres';

/** Où se trouve une table, dans les termes de l'API de son provider. */
export interface RemoteTableLocator {
  provider: RemoteProvider;
  /** Clé stable de regroupement (`airtable:app/tbl`, `sheets:doc#gid`…). */
  key: string;
  /**
   * Identifiants propres au provider : `base`/`table` (Airtable), `project`/
   * `table` (NocoDB), `database` (Notion), `document`/`sheet` + `sheetMode`
   * (Sheets : un onglet se désigne par son gid OU par son nom), `schema`/`table`
   * (Postgres).
   */
  ids: Record<string, string>;
  label?: string;
  /** Credential n8n du nœud : c'est par elle que la table se lit. */
  credential?: { type: string; id: string; name?: string };
}

export interface RequiredColumn {
  name: string;
  access: 'read' | 'write';
  nodeName: string;
  /** Nœud Set qui pose la clé, quand la colonne vient d'un mapping automatique. */
  via?: string;
  /**
   * Une colonne absente est-elle une panne ? `warning` quand le nœud tolère
   * l'extra (Sheets « ignorer les données en trop » : rien ne casse, la
   * donnée se perd).
   */
  severity: 'error' | 'warning';
}

export interface RemoteTableRequirement {
  locator: RemoteTableLocator;
  nodes: string[];
  columns: RequiredColumn[];
  /** Nœuds dont une partie des colonnes n'est pas déductible : jamais « rien à vérifier ». */
  partial: Array<{ nodeName: string; reason: string }>;
}

/** Nœud dont la table ne se laisse pas désigner : expression, forme inconnue. */
export interface UnlocatableNode {
  nodeName: string;
  provider: RemoteProvider;
  reason: string;
}

export interface RemoteRequirements {
  tables: RemoteTableRequirement[];
  unlocatable: UnlocatableNode[];
}

type Params = Record<string, unknown>;

const CREDENTIAL_TYPES: Record<RemoteProvider, RegExp> = {
  airtable: /^airtable/i,
  nocodb: /^nocodb/i,
  notion: /^notion/i,
  'google-sheets': /^google/i,
  postgres: /^postgres/i,
};

function isObject(value: unknown): value is Params {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function providerOf(node: N8nNode): RemoteProvider | undefined {
  const type = node.type.toLowerCase();
  if (type.endsWith('trigger')) return undefined;
  if (type.includes('airtable')) return 'airtable';
  if (type.includes('nocodb')) return 'nocodb';
  if (type.includes('notion')) return 'notion';
  if (type.includes('googlesheets')) return 'google-sheets';
  if (type.includes('postgres')) return 'postgres';
  return undefined;
}

function isDynamic(value: string | undefined): boolean {
  return !!value && value.includes('{{');
}

function credentialOf(node: N8nNode, provider: RemoteProvider): RemoteTableLocator['credential'] {
  for (const [type, credential] of Object.entries(node.credentials ?? {})) {
    if (CREDENTIAL_TYPES[provider].test(type) && credential?.id) {
      return { type, id: credential.id, name: credential.name };
    }
  }
  return undefined;
}

/** Gid d'un onglet désigné par URL (`…#gid=123`) ou par la liste (`gid=0`, `0`). */
function sheetGid(value: string): string {
  const match = /gid=(\d+)/.exec(value);
  return match ? match[1] : value;
}

type Located = { locator: RemoteTableLocator } | { reason: string };

function locate(node: N8nNode, provider: RemoteProvider): Located {
  const p = node.parameters ?? {};
  const credential = credentialOf(node, provider);
  const dynamic = { reason: msg('checks.remoteTableDynamic') };
  const missing = { reason: msg('checks.remoteTableUnset') };

  if (provider === 'airtable') {
    const base = paramString(p.base ?? p.application);
    const table = paramString(p.table);
    if (!base || !table) return missing;
    if (isDynamic(base) || isDynamic(table)) return dynamic;
    return {
      locator: {
        provider,
        key: `airtable:${base}/${table}`,
        ids: { base, table },
        label:
          [paramLabel(p.base ?? p.application), paramLabel(p.table)].filter(Boolean).join(' — ') || undefined,
        credential,
      },
    };
  }
  if (provider === 'nocodb') {
    const project = paramString(p.projectId) ?? '';
    const table = paramString(p.table);
    if (!table) return missing;
    if (isDynamic(table) || isDynamic(project)) return dynamic;
    return {
      locator: {
        provider,
        key: `nocodb:${project || '?'}/${table}`,
        ids: { project, table },
        label: [paramLabel(p.projectId), paramLabel(p.table)].filter(Boolean).join(' — ') || undefined,
        credential,
      },
    };
  }
  if (provider === 'notion') {
    const database = paramString(p.databaseId);
    if (!database) return missing;
    if (isDynamic(database)) return dynamic;
    return {
      locator: {
        provider,
        key: `notion:${database}`,
        ids: { database },
        label: paramLabel(p.databaseId),
        credential,
      },
    };
  }
  if (provider === 'google-sheets') {
    const document = paramString(p.documentId);
    const sheetParam = p.sheetName;
    const sheet = paramString(sheetParam);
    if (!document || !sheet) return missing;
    if (isDynamic(document) || isDynamic(sheet)) return dynamic;
    const byName = isObject(sheetParam) && sheetParam.mode === 'name';
    const id = byName ? sheet : sheetGid(sheet);
    return {
      locator: {
        provider,
        key: `sheets:${document}#${byName ? `name:${id}` : id}`,
        ids: { document, sheet: id, sheetMode: byName ? 'name' : 'gid' },
        label: [paramLabel(p.documentId), paramLabel(sheetParam)].filter(Boolean).join(' — ') || undefined,
        credential,
      },
    };
  }
  const table = paramString(p.table);
  const schema = paramString(p.schema) ?? 'public';
  if (!table) return missing;
  if (isDynamic(table) || isDynamic(schema)) return dynamic;
  return {
    locator: {
      provider,
      key: `postgres:${schema}.${table}`,
      ids: { schema, table },
      label: `${schema}.${table}`,
      credential,
    },
  };
}

/** Propriétés Notion écrites : `key` vaut `Nom|type`. */
function notionProperties(params: Params): string[] | undefined {
  const ui = params.propertiesUi;
  if (!isObject(ui) || !Array.isArray(ui.propertyValues)) return undefined;
  return ui.propertyValues
    .map((entry) => (isObject(entry) && typeof entry.key === 'string' ? entry.key.split('|')[0] : ''))
    .filter((name) => name.length > 0 && !isDynamic(name));
}

/** Clés que n8n consomme sans les écrire comme colonnes. */
function isTechnicalKey(provider: RemoteProvider, name: string): boolean {
  return provider === 'airtable' && name === 'id';
}

/** Mapping automatique : le nœud écrit les clés qu'il reçoit. */
function autoMaps(params: Params): boolean {
  const walk = (value: unknown): boolean => {
    if (!isObject(value)) return false;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === 'mappingMode' || key === 'dataToSend') &&
        typeof child === 'string' &&
        /auto/i.test(child)
      ) {
        return true;
      }
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(params);
}

/**
 * Sheets en append/update automatique : que faire d'une clé sans colonne.
 * n8n l'insère en nouvelle colonne par défaut — rien à exiger du distant.
 */
function sheetsExtraHandling(params: Params): 'insert' | 'ignore' | 'error' {
  const options = isObject(params.options) ? params.options : {};
  const value = options.handlingExtraData;
  if (value === 'ignoreIt') return 'ignore';
  if (value === 'error') return 'error';
  return 'insert';
}

/** Tables et colonnes que le workflow attend du distant. */
export function requiredRemoteSchema(workflow: N8nWorkflow): RemoteRequirements {
  const usagesByNode = new Map(extractResourceFieldUsages(workflow).map((usage) => [usage.nodeName, usage]));
  const tables = new Map<string, RemoteTableRequirement>();
  const unlocatable: UnlocatableNode[] = [];

  for (const node of workflow.nodes) {
    if (node.disabled) continue;
    const provider = providerOf(node);
    if (!provider) continue;
    const usage = usagesByNode.get(node.name);
    if (usage && usage.access !== 'read' && usage.access !== 'write') continue;

    const located = locate(node, provider);
    if ('reason' in located) {
      unlocatable.push({ nodeName: node.name, provider, reason: located.reason });
      continue;
    }
    const { locator } = located;
    const entry = tables.get(locator.key) ?? { locator, nodes: [], columns: [], partial: [] };
    if (!entry.locator.credential && locator.credential)
      entry.locator = { ...entry.locator, credential: locator.credential };
    tables.set(locator.key, entry);
    entry.nodes.push(node.name);

    const params = activeParameters(node);
    const access: 'read' | 'write' = usage?.access === 'write' ? 'write' : 'read';
    const add = (name: string, severity: RequiredColumn['severity'], via?: string) => {
      if (isTechnicalKey(provider, name)) return;
      if (entry.columns.some((column) => column.name === name && column.nodeName === node.name)) return;
      entry.columns.push({ name, access, nodeName: node.name, via, severity });
    };

    const listed = usage?.fields ?? (provider === 'notion' ? notionProperties(params) : undefined);
    for (const name of listed ?? []) if (!isDynamic(name)) add(name, 'error');
    for (const name of usage?.matchingColumns ?? []) add(name, 'error');

    if (access === 'write' && !listed && autoMaps(params)) {
      const extra = provider === 'google-sheets' ? sheetsExtraHandling(params) : 'error';
      if (extra === 'insert') continue;
      const received = upstreamKeys(workflow, node.name);
      for (const key of received.keys) add(key.name, extra === 'ignore' ? 'warning' : 'error', key.setNode);
      for (const source of received.unknownSources) {
        entry.partial.push({
          nodeName: node.name,
          reason: msg('checks.remotePartialSource', { node: source.nodeName, reason: source.reason }),
        });
      }
    } else if (access === 'write' && usage && !usage.understood && !listed) {
      entry.partial.push({ nodeName: node.name, reason: msg('checks.remoteMappingUnknown') });
    }
  }

  return { tables: [...tables.values()], unlocatable };
}
