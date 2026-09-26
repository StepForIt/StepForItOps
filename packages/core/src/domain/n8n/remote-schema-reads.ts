/**
 * Comment lire les colonnes d'une table, provider par provider — requêtes et
 * lecture des réponses, sans IO. L'appel lui-même part d'un workflow n8n
 * temporaire authentifié par la credential du nœud : la plateforme ne détient
 * aucun secret de ces systèmes.
 */

import { RemoteTableLocator } from './remote-requirements';
import { RemoteColumn, RemoteTableSchema } from './remote-schema-compare';
import { msg } from '../../i18n/translate';

/** Requête HTTP exécutée par le workflow temporaire. */
export interface ProbeHttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  jsonBody?: unknown;
}

/** Même version que la découverte : au-delà, Notion range les colonnes sous `data_sources`. */
export const NOTION_VERSION = '2022-06-28';

export type SchemaRead =
  | { kind: 'http'; request: ProbeHttpRequest; parse: (body: unknown) => RemoteTableSchema }
  | { kind: 'sql'; schema: string; table: string }
  /** Sheets par gid : il faut d'abord le titre de l'onglet pour lire sa ligne d'en-tête. */
  | { kind: 'sheet-title'; request: ProbeHttpRequest; gid: string; document: string }
  | { kind: 'unsupported'; reason: string };

function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Colonnes nommées seulement : une entrée sans nom ne désigne rien. */
function named(entries: Array<{ name?: string; alias?: string; type?: string }>): RemoteColumn[] {
  return entries.flatMap(({ name, alias, type }) =>
    name ? [{ name, ...(alias ? { alias } : {}), ...(type ? { type } : {}) }] : [],
  );
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Plage A1 d'un onglet : le titre est cité, apostrophes doublées. */
export function sheetHeaderRequest(document: string, title: string, headerRow = 1): ProbeHttpRequest {
  const range = `'${title.replace(/'/g, "''")}'!${headerRow}:${headerRow}`;
  return {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(document)}/values/${encodeURIComponent(range)}`,
  };
}

/** Ligne d'en-tête : chaque cellule non vide est une colonne. */
export function parseSheetHeader(body: unknown): RemoteTableSchema {
  const row = asArray(asArray(prop(body, 'values'))[0]);
  return {
    found: true,
    columns: row
      .map((cell) => String(cell ?? '').trim())
      .filter(Boolean)
      .map((name) => ({ name })),
  };
}

/** Titre de l'onglet `gid`, ou `undefined` s'il n'existe plus. */
export function parseSheetTitle(body: unknown, gid: string): string | undefined {
  for (const sheet of asArray(prop(body, 'sheets'))) {
    const properties = prop(sheet, 'properties');
    if (String(prop(properties, 'sheetId')) === gid) return text(prop(properties, 'title'));
  }
  return undefined;
}

/** Colonnes d'un `information_schema.columns` rendu ligne à ligne par le nœud Postgres. */
export function parsePostgresColumns(rows: unknown[]): RemoteTableSchema {
  const columns = named(
    rows.map((row) => ({ name: text(prop(row, 'column_name')), type: text(prop(row, 'data_type')) })),
  );
  return columns.length > 0 ? { found: true, columns } : { found: false };
}

/** La requête SQL et ses paramètres, liés par `queryReplacement` : jamais concaténés. */
export const POSTGRES_COLUMNS_QUERY =
  'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position';

/** Comment lire la table désignée. `host` : racine d'API des providers auto-hébergés (NocoDB). */
export function schemaReadFor(locator: RemoteTableLocator, context: { host?: string } = {}): SchemaRead {
  const { ids } = locator;
  switch (locator.provider) {
    case 'airtable':
      return {
        kind: 'http',
        request: { url: `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(ids.base)}/tables` },
        parse: (body): RemoteTableSchema => {
          const table = asArray(prop(body, 'tables')).find(
            (candidate) => prop(candidate, 'id') === ids.table || prop(candidate, 'name') === ids.table,
          );
          if (!table) return { found: false };
          return {
            found: true,
            columns: named(
              asArray(prop(table, 'fields')).map((field) => ({
                name: text(prop(field, 'name')),
                type: text(prop(field, 'type')),
              })),
            ),
          };
        },
      };
    case 'nocodb':
      if (!context.host) {
        return {
          kind: 'unsupported',
          reason: msg('checks.nocodbHostUnknown'),
        };
      }
      return {
        kind: 'http',
        request: { url: `${context.host}/api/v2/meta/tables/${encodeURIComponent(ids.table)}` },
        parse: (body) => ({
          found: true,
          columns: named(
            asArray(prop(body, 'columns')).map((column) => ({
              name: text(prop(column, 'title')),
              alias: text(prop(column, 'column_name')),
              type: text(prop(column, 'uidt')),
            })),
          ),
        }),
      };
    case 'notion':
      return {
        kind: 'http',
        request: {
          url: `https://api.notion.com/v1/databases/${encodeURIComponent(ids.database)}`,
          headers: { 'Notion-Version': NOTION_VERSION },
        },
        parse: (body): RemoteTableSchema => {
          const properties = prop(body, 'properties');
          if (typeof properties !== 'object' || properties === null) return { found: false };
          return {
            found: true,
            columns: Object.entries(properties as Record<string, unknown>).map(([name, value]) => ({
              name,
              type: text(prop(value, 'type')),
            })),
          };
        },
      };
    case 'google-sheets':
      if (ids.sheetMode === 'name') {
        return {
          kind: 'http',
          request: sheetHeaderRequest(ids.document, ids.sheet),
          parse: parseSheetHeader,
        };
      }
      return {
        kind: 'sheet-title',
        document: ids.document,
        gid: ids.sheet,
        request: {
          url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ids.document)}?fields=sheets.properties`,
        },
      };
    case 'postgres':
      return { kind: 'sql', schema: ids.schema, table: ids.table };
  }
}

/** Statuts qui disent « cette table n'existe pas » plutôt que « on n'a pas pu lire ». */
export function isNotFoundStatus(status: number): boolean {
  return status === 404;
}
