import { describe, expect, it } from 'vitest';
import { upstreamKeys } from '../src/domain/n8n/upstream-keys';
import { requiredRemoteSchema } from '../src/domain/n8n/remote-requirements';
import { compareRemoteSchema } from '../src/domain/n8n/remote-schema-compare';
import {
  parsePostgresColumns,
  parseSheetHeader,
  parseSheetTitle,
  schemaReadFor,
} from '../src/domain/n8n/remote-schema-reads';
import { buildRemoteSchemaReport } from '../src/domain/n8n/remote-schema-report';
import { N8nConnections, N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const base = { __rl: true, mode: 'list', value: 'appCRM', cachedResultName: 'CRM' };
const table = { __rl: true, mode: 'list', value: 'tblLeads', cachedResultName: 'Leads' };
const airtableCredential = { airtableTokenApi: { id: 'cred1', name: 'Airtable' } };

function link(...pairs: Array<[string, string, number?]>): N8nConnections {
  const connections: N8nConnections = {};
  for (const [from, to, output = 0] of pairs) {
    const outputs = (connections[from] ??= { main: [] }).main;
    while (outputs.length <= output) outputs.push([]);
    outputs[output].push({ node: to, type: 'main', index: 0 });
  }
  return connections;
}

function workflowOf(nodes: N8nNode[], connections: N8nConnections): N8nWorkflow {
  return { name: 'wf', nodes, connections };
}

const trigger: N8nNode = { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {} };

function setNode(name: string, keys: string[], extra: Record<string, unknown> = {}): N8nNode {
  return {
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    parameters: {
      assignments: {
        assignments: keys.map((key, i) => ({ id: String(i), name: key, value: 'x', type: 'string' })),
      },
      options: {},
      ...extra,
    },
  };
}

const ifNode: N8nNode = { name: 'Client ?', type: 'n8n-nodes-base.if', typeVersion: 2, parameters: {} };

function airtableAutoCreate(name = 'Créer lead'): N8nNode {
  return {
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    credentials: airtableCredential,
    parameters: {
      operation: 'create',
      base,
      table,
      columns: { mappingMode: 'autoMapInputData', value: {}, schema: [] },
    },
  };
}

describe('upstreamKeys — ce qu’un mapping automatique reçoit', () => {
  it('lit les clés du Set juste avant', () => {
    const wf = workflowOf(
      [trigger, setNode('Préparer', ['Nom', 'Email']), airtableAutoCreate()],
      link(['Webhook', 'Préparer'], ['Préparer', 'Créer lead']),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys.map((key) => key.name)).toEqual(['Nom', 'Email']);
    expect(result.keys[0].setNode).toBe('Préparer');
    expect(result.complete).toBe(true);
  });

  it('fait l’union de deux Set derrière un IF, à travers un nœud qui laisse passer', () => {
    const wf = workflowOf(
      [
        trigger,
        ifNode,
        setNode('Client', ['Nom', 'Statut']),
        setNode('Prospect', ['Nom', 'Source']),
        airtableAutoCreate(),
      ],
      link(
        ['Webhook', 'Client ?'],
        ['Client ?', 'Client', 0],
        ['Client ?', 'Prospect', 1],
        ['Client', 'Créer lead'],
        ['Prospect', 'Créer lead'],
      ),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys.map((key) => key.name).sort()).toEqual(['Nom', 'Source', 'Statut']);
    expect(result.complete).toBe(true);
  });

  it('traverse un NoOp entre le Set et l’écriture', () => {
    const noop: N8nNode = { name: 'Jalon', type: 'n8n-nodes-base.noOp', parameters: {} };
    const wf = workflowOf(
      [trigger, setNode('Préparer', ['Nom']), noop, airtableAutoCreate()],
      link(['Webhook', 'Préparer'], ['Préparer', 'Jalon'], ['Jalon', 'Créer lead']),
    );
    expect(upstreamKeys(wf, 'Créer lead').keys.map((key) => key.name)).toEqual(['Nom']);
  });

  it('dit incomplet un Set en mode JSON', () => {
    const raw = setNode('Brut', [], { mode: 'raw', jsonOutput: '={{ $json }}' });
    const wf = workflowOf(
      [trigger, raw, airtableAutoCreate()],
      link(['Webhook', 'Brut'], ['Brut', 'Créer lead']),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.complete).toBe(false);
    expect(result.unknownSources[0].nodeName).toBe('Brut');
  });

  it('garde les clés connues d’un Set dont un nom est calculé, mais le dit incomplet', () => {
    const wf = workflowOf(
      [trigger, setNode('Préparer', ['Nom', '={{ $json.champ }}']), airtableAutoCreate()],
      link(['Webhook', 'Préparer'], ['Préparer', 'Créer lead']),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys.map((key) => key.name)).toEqual(['Nom']);
    expect(result.complete).toBe(false);
  });

  it('remonte au-delà d’un Set qui garde les autres champs, jusqu’à la source inconnue', () => {
    const wf = workflowOf(
      [trigger, setNode('Compléter', ['Statut'], { includeOtherFields: true }), airtableAutoCreate()],
      link(['Webhook', 'Compléter'], ['Compléter', 'Créer lead']),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys.map((key) => key.name)).toEqual(['Statut']);
    expect(result.complete).toBe(false);
    expect(result.unknownSources[0].nodeName).toBe('Webhook');
  });

  it('écriture branchée directement sur un webhook : rien de connu', () => {
    const wf = workflowOf([trigger, airtableAutoCreate()], link(['Webhook', 'Créer lead']));
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('lit les Set v1 (valeurs rangées par type)', () => {
    const legacy: N8nNode = {
      name: 'Ancien',
      type: 'n8n-nodes-base.set',
      typeVersion: 2,
      parameters: { keepOnlySet: true, values: { string: [{ name: 'Nom' }], number: [{ name: 'Score' }] } },
    };
    const wf = workflowOf(
      [trigger, legacy, airtableAutoCreate()],
      link(['Webhook', 'Ancien'], ['Ancien', 'Créer lead']),
    );
    const result = upstreamKeys(wf, 'Créer lead');
    expect(result.keys.map((key) => key.name)).toEqual(['Nom', 'Score']);
    expect(result.complete).toBe(true);
  });
});

describe('requiredRemoteSchema — colonnes attendues par table', () => {
  it('rattache les clés d’un Set à la table écrite en auto-map, avec la credential du nœud', () => {
    const wf = workflowOf(
      [trigger, setNode('Préparer', ['Nom', 'Email', 'id']), airtableAutoCreate()],
      link(['Webhook', 'Préparer'], ['Préparer', 'Créer lead']),
    );
    const { tables } = requiredRemoteSchema(wf);
    expect(tables).toHaveLength(1);
    expect(tables[0].locator).toMatchObject({
      provider: 'airtable',
      key: 'airtable:appCRM/tblLeads',
      ids: { base: 'appCRM', table: 'tblLeads' },
      credential: { type: 'airtableTokenApi', id: 'cred1' },
    });
    // `id` est l'identifiant de l'enregistrement pour Airtable, pas une colonne.
    expect(tables[0].columns.map((column) => [column.name, column.via])).toEqual([
      ['Nom', 'Préparer'],
      ['Email', 'Préparer'],
    ]);
    expect(tables[0].partial).toEqual([]);
  });

  it('prend un mapping manuel et la sélection d’une lecture', () => {
    const write: N8nNode = {
      name: 'Mettre à jour',
      type: 'n8n-nodes-base.airtable',
      parameters: {
        operation: 'update',
        base,
        table,
        columns: {
          mappingMode: 'defineBelow',
          matchingColumns: ['Email'],
          value: { Email: 'a', Statut: 'b' },
        },
      },
    };
    const read: N8nNode = {
      name: 'Chercher',
      type: 'n8n-nodes-base.airtable',
      parameters: { operation: 'search', base, table, options: { fields: ['Nom', 'Téléphone'] } },
    };
    const { tables } = requiredRemoteSchema(workflowOf([write, read], {}));
    const columns = tables[0].columns.map((column) => `${column.access}:${column.name}`);
    expect(columns.sort()).toEqual(['read:Nom', 'read:Téléphone', 'write:Email', 'write:Statut']);
  });

  it('signale une écriture en auto-map dont la source est inconnue au lieu de la taire', () => {
    const wf = workflowOf([trigger, airtableAutoCreate()], link(['Webhook', 'Créer lead']));
    const { tables } = requiredRemoteSchema(wf);
    expect(tables[0].columns).toEqual([]);
    expect(tables[0].partial[0].nodeName).toBe('Créer lead');
  });

  it('écarte une table désignée par une expression', () => {
    const dynamic: N8nNode = {
      ...airtableAutoCreate(),
      parameters: {
        operation: 'create',
        base,
        table: { __rl: true, mode: 'id', value: '={{ $json.table }}' },
      },
    };
    const result = requiredRemoteSchema(workflowOf([dynamic], {}));
    expect(result.tables).toEqual([]);
    expect(result.unlocatable[0]).toMatchObject({ nodeName: 'Créer lead', provider: 'airtable' });
  });

  it('Sheets : une clé en trop devient une colonne par défaut, un avertissement si elle est ignorée', () => {
    const sheet = (handling?: string): N8nNode => ({
      name: 'Ajouter ligne',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      parameters: {
        operation: 'append',
        documentId: { __rl: true, mode: 'list', value: 'doc1' },
        sheetName: { __rl: true, mode: 'list', value: 'gid=0' },
        columns: { mappingMode: 'autoMapInputData', value: {} },
        options: handling ? { handlingExtraData: handling } : {},
      },
    });
    const flow = (node: N8nNode) =>
      workflowOf(
        [trigger, setNode('Préparer', ['Nom']), node],
        link(['Webhook', 'Préparer'], ['Préparer', 'Ajouter ligne']),
      );

    expect(requiredRemoteSchema(flow(sheet())).tables[0].columns).toEqual([]);
    const ignored = requiredRemoteSchema(flow(sheet('ignoreIt'))).tables[0];
    expect(ignored.locator.ids).toEqual({ document: 'doc1', sheet: '0', sheetMode: 'gid' });
    expect(ignored.columns[0]).toMatchObject({ name: 'Nom', severity: 'warning' });
  });

  it('Notion : les propriétés écrites, sans leur type', () => {
    const notion: N8nNode = {
      name: 'Créer page',
      type: 'n8n-nodes-base.notion',
      parameters: {
        resource: 'databasePage',
        operation: 'create',
        databaseId: { __rl: true, mode: 'list', value: 'db1' },
        propertiesUi: { propertyValues: [{ key: 'Nom|title' }, { key: 'Statut|select' }] },
      },
    };
    const { tables } = requiredRemoteSchema(workflowOf([notion], {}));
    expect(tables[0].columns.map((column) => column.name)).toEqual(['Nom', 'Statut']);
  });
});

describe('compareRemoteSchema', () => {
  const wf = workflowOf(
    [trigger, setNode('Préparer', ['Nom', 'Emal']), airtableAutoCreate()],
    link(['Webhook', 'Préparer'], ['Préparer', 'Créer lead']),
  );
  const [requirement] = requiredRemoteSchema(wf).tables;

  it('une colonne absente cite le Set qui la pose et propose la plus proche', () => {
    const findings = compareRemoteSchema(requirement, {
      found: true,
      columns: [{ name: 'Nom' }, { name: 'Email' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      code: 'remote-column-missing',
      nodeName: 'Créer lead',
    });
    expect(findings[0].message).toContain('Préparer');
    expect(findings[0].data?.suggestion).toContain('Email');
  });

  it('une table introuvable est un finding par nœud', () => {
    const findings = compareRemoteSchema(requirement, { found: false });
    expect(findings.map((finding) => finding.code)).toEqual(['remote-table-missing']);
  });

  it('rien à dire quand tout est là', () => {
    expect(
      compareRemoteSchema(requirement, { found: true, columns: [{ name: 'Nom' }, { name: 'Emal' }] }),
    ).toEqual([]);
  });
});

describe('schemaReadFor — lecture par provider', () => {
  it('Airtable : retrouve la table par id ou par nom dans les métadonnées de la base', () => {
    const read = schemaReadFor({ provider: 'airtable', key: 'k', ids: { base: 'app1', table: 'Leads' } });
    if (read.kind !== 'http') throw new Error(read.kind);
    expect(read.request.url).toBe('https://api.airtable.com/v0/meta/bases/app1/tables');
    const body = {
      tables: [{ id: 'tbl1', name: 'Leads', fields: [{ name: 'Nom', type: 'singleLineText' }] }],
    };
    expect(read.parse(body)).toEqual({ found: true, columns: [{ name: 'Nom', type: 'singleLineText' }] });
    expect(read.parse({ tables: [] })).toEqual({ found: false });
  });

  it('NocoDB : sans host, non vérifiable ; avec, titre et nom technique', () => {
    const locator = { provider: 'nocodb' as const, key: 'k', ids: { project: 'p', table: 'm1' } };
    expect(schemaReadFor(locator).kind).toBe('unsupported');
    const read = schemaReadFor(locator, { host: 'https://noco.example' });
    if (read.kind !== 'http') throw new Error(read.kind);
    expect(read.request.url).toBe('https://noco.example/api/v2/meta/tables/m1');
    expect(read.parse({ columns: [{ title: 'Nom', column_name: 'nom', uidt: 'SingleLineText' }] })).toEqual({
      found: true,
      columns: [{ name: 'Nom', alias: 'nom', type: 'SingleLineText' }],
    });
  });

  it('Notion : les propriétés de la base', () => {
    const read = schemaReadFor({ provider: 'notion', key: 'k', ids: { database: 'db1' } });
    if (read.kind !== 'http') throw new Error(read.kind);
    expect(read.request.headers?.['Notion-Version']).toBeDefined();
    expect(read.parse({ properties: { Nom: { type: 'title' } } })).toEqual({
      found: true,
      columns: [{ name: 'Nom', type: 'title' }],
    });
  });

  it('Sheets par gid : passe par le titre de l’onglet, puis la ligne d’en-tête', () => {
    const read = schemaReadFor({
      provider: 'google-sheets',
      key: 'k',
      ids: { document: 'doc1', sheet: '42', sheetMode: 'gid' },
    });
    expect(read.kind).toBe('sheet-title');
    expect(parseSheetTitle({ sheets: [{ properties: { sheetId: 42, title: 'Leads' } }] }, '42')).toBe(
      'Leads',
    );
    expect(parseSheetHeader({ values: [['Nom', '', 'Email']] })).toEqual({
      found: true,
      columns: [{ name: 'Nom' }, { name: 'Email' }],
    });
  });

  it('Postgres : aucune ligne dans information_schema = table introuvable', () => {
    expect(parsePostgresColumns([])).toEqual({ found: false });
    expect(parsePostgresColumns([{ column_name: 'email', data_type: 'text' }])).toEqual({
      found: true,
      columns: [{ name: 'email', type: 'text' }],
    });
  });
});

describe('buildRemoteSchemaReport', () => {
  const wf = workflowOf(
    [trigger, setNode('Préparer', ['Nom', 'Segmnt']), airtableAutoCreate()],
    link(['Webhook', 'Préparer'], ['Préparer', 'Créer lead']),
  );
  const requirements = requiredRemoteSchema(wf);
  const key = requirements.tables[0].locator.key;

  it('marque chaque colonne présente ou non, avec la plus proche', () => {
    const report = buildRemoteSchemaReport(
      requirements,
      new Map([
        [key, { status: 'read', schema: { found: true, columns: [{ name: 'Nom' }, { name: 'Segment' }] } }],
      ]),
    );
    expect(report.tables[0].status).toBe('issues');
    expect(
      report.tables[0].columns.map((column) => [column.name, column.present, column.suggestion]),
    ).toEqual([
      ['Nom', true, undefined],
      ['Segmnt', false, 'Segment'],
    ]);
    expect(report.findings).toHaveLength(1);
  });

  it('une table non lue reste « unverified » et ne produit aucun finding', () => {
    const report = buildRemoteSchemaReport(requirements, new Map());
    expect(report.tables[0]).toMatchObject({ status: 'unverified', reason: 'table non lue' });
    expect(report.tables[0].columns.every((column) => column.present === null)).toBe(true);
    expect(report.findings).toEqual([]);
  });
});
