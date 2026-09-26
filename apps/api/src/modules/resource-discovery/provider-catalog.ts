/**
 * Catalogue des providers découvrables : credentials n8n compatibles + étapes de
 * listing. Les SaaS ont une URL d'API fixe ; NocoDB range la sienne dans le
 * credential que l'API n8n ne rend pas — son host est fourni par l'appelant
 * (`ProviderEndpoint`) et dit aussi cloud ou auto-hébergé (cf. `isNocoDbCloud`).
 */

import { ProbeHttpRequest, msg } from '@nwm/core';

/** Requête exécutée par le nœud HTTP Request du workflow temporaire. */
export type DiscoveryRequest = ProbeHttpRequest;

/** Ce dont une étape dispose pour bâtir sa requête. */
export interface DiscoveryContext {
  /** Item de l'étape parente (baseId pour lister des tables…). */
  parentId?: string;
  /** Racine de l'API, sans slash final — seulement pour les providers auto-hébergés. */
  host?: string;
}

export interface DiscoveredItem {
  id: string;
  name: string;
  /** Clé de ligne suggérée pour le formulaire de mapping (baseId, table_xxx…). */
  suggestedKey: string;
}

export interface DiscoveryStep {
  id: string;
  label: string;
  /** Étape parente dont un item doit être fourni (ex : tables ← id d'une base). */
  parentStepId?: string;
  /** Détour technique, jamais proposé par le drawer « Parcourir depuis n8n ». */
  internal?: boolean;
  request(context: DiscoveryContext): DiscoveryRequest;
  parse(body: unknown): DiscoveredItem[];
}

export interface ProviderDiscovery {
  provider: string;
  credentialTypes: string[];
  /** Le host de l'API doit être fourni : il n'est pas déductible du credential. */
  needsHost?: boolean;
  steps: DiscoveryStep[];
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function prop(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

export const DISCOVERY_PROVIDERS: ProviderDiscovery[] = [
  {
    provider: 'airtable',
    credentialTypes: ['airtableTokenApi', 'airtableApi', 'airtableOAuth2Api'],
    steps: [
      {
        id: 'bases',
        label: 'Bases',
        request: () => ({ url: 'https://api.airtable.com/v0/meta/bases' }),
        parse: (body) =>
          asArray(prop(body, 'bases')).map((base) => ({
            id: String(prop(base, 'id') ?? ''),
            name: String(prop(base, 'name') ?? ''),
            suggestedKey: 'baseId',
          })),
      },
      {
        id: 'tables',
        label: 'Tables',
        parentStepId: 'bases',
        request: ({ parentId }) => ({ url: `https://api.airtable.com/v0/meta/bases/${parentId}/tables` }),
        parse: (body) =>
          asArray(prop(body, 'tables')).map((table) => {
            const name = String(prop(table, 'name') ?? '');
            return { id: String(prop(table, 'id') ?? ''), name, suggestedKey: `table_${slug(name)}` };
          }),
      },
    ],
  },
  {
    provider: 'notion',
    credentialTypes: ['notionApi'],
    steps: [
      {
        id: 'databases',
        label: 'Databases',
        request: () => ({
          url: 'https://api.notion.com/v1/search',
          method: 'POST',
          headers: { 'Notion-Version': '2022-06-28' },
          jsonBody: { filter: { property: 'object', value: 'database' }, page_size: 100 },
        }),
        parse: (body) =>
          asArray(prop(body, 'results')).map((db) => {
            const name =
              asArray(prop(db, 'title'))
                .map((t) => String(prop(t, 'plain_text') ?? ''))
                .join('') || msg('platform.untitled');
            return { id: String(prop(db, 'id') ?? ''), name, suggestedKey: `db_${slug(name)}` };
          }),
      },
    ],
  },
  {
    provider: 'google-sheets',
    // googleDriveOAuth2Api : le scope "drive" autorise aussi le listing des
    // spreadsheets (API Drive) et la lecture des onglets (API Sheets).
    credentialTypes: [
      'googleSheetsOAuth2Api',
      'googleSheetsTriggerOAuth2Api',
      'googleDriveOAuth2Api',
      'googleApi',
    ],
    steps: [
      {
        id: 'spreadsheets',
        label: 'Spreadsheets',
        request: () => ({
          url: 'https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&pageSize=100&fields=files(id%2Cname)',
        }),
        parse: (body) =>
          asArray(prop(body, 'files')).map((file) => ({
            id: String(prop(file, 'id') ?? ''),
            name: String(prop(file, 'name') ?? ''),
            suggestedKey: 'spreadsheetId',
          })),
      },
      {
        id: 'sheets',
        label: 'Onglets',
        parentStepId: 'spreadsheets',
        request: ({ parentId }) => ({
          url: `https://sheets.googleapis.com/v4/spreadsheets/${parentId}?fields=sheets.properties`,
        }),
        parse: (body) =>
          asArray(prop(body, 'sheets')).map((sheet) => {
            const properties = prop(sheet, 'properties');
            const name = String(prop(properties, 'title') ?? '');
            return {
              id: String(prop(properties, 'sheetId') ?? ''),
              name,
              suggestedKey: `sheet_${slug(name)}`,
            };
          }),
      },
    ],
  },
  {
    provider: 'nocodb',
    // Le credential ne fait qu'apposer `xc-token` : c'est nous qui portons l'URL.
    credentialTypes: ['nocoDbApiToken', 'nocoDbApi'],
    needsHost: true,
    steps: [
      {
        id: 'workspaces',
        label: 'Workspaces',
        // Le cloud seul en a : c'est `NocoDbLabelsService` qui décide d'y passer.
        internal: true,
        request: ({ host }) => ({ url: `${host}/api/v2/meta/workspaces` }),
        parse: (body) =>
          asArray(prop(body, 'list')).map((workspace) => {
            const name = String(prop(workspace, 'title') ?? '');
            return { id: String(prop(workspace, 'id') ?? ''), name, suggestedKey: 'workspaceId' };
          }),
      },
      {
        id: 'bases',
        label: 'Bases',
        // Sans workspace, la route racine de l'auto-hébergé ; avec, celle du cloud,
        // où la racine répond 403. Même réponse (`list`) des deux côtés.
        request: ({ host, parentId }) => ({
          url: parentId ? `${host}/api/v2/meta/workspaces/${parentId}/bases` : `${host}/api/v2/meta/bases`,
        }),
        parse: (body) =>
          asArray(prop(body, 'list')).map((base) => {
            const name = String(prop(base, 'title') ?? '');
            return { id: String(prop(base, 'id') ?? ''), name, suggestedKey: 'projectId' };
          }),
      },
      {
        id: 'tables',
        label: 'Tables',
        parentStepId: 'bases',
        request: ({ host, parentId }) => ({ url: `${host}/api/v2/meta/bases/${parentId}/tables` }),
        parse: (body) =>
          asArray(prop(body, 'list')).map((table) => {
            const name = String(prop(table, 'title') ?? prop(table, 'table_name') ?? '');
            return { id: String(prop(table, 'id') ?? ''), name, suggestedKey: `table_${slug(name)}` };
          }),
      },
    ],
  },
];

/** Racine d'API utilisable : sans slash final, https par défaut. */
export function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function findDiscoveryStep(
  providerId: string,
  stepId: string,
): { provider: ProviderDiscovery; step: DiscoveryStep } | null {
  const provider = DISCOVERY_PROVIDERS.find((p) => p.provider === providerId);
  const step = provider?.steps.find((s) => s.id === stepId);
  return provider && step ? { provider, step } : null;
}
