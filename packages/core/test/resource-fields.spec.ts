import { describe, expect, it } from 'vitest';
import {
  columnImpact,
  extractResourceFieldUsages,
  requiredNotMapped,
  ResourceFieldUsage,
} from '../src/domain/n8n/resource-fields';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const base = { __rl: true, mode: 'list', value: 'app0GW', cachedResultName: 'Production' };
const table = { __rl: true, mode: 'list', value: 'tblProspects', cachedResultName: 'Prospects' };
const KEY = 'airtable:app0GW/tblProspects';

function workflowOf(...nodes: N8nNode[]): N8nWorkflow {
  return { name: 'wf', nodes, connections: {} };
}

function usageOf(node: N8nNode): ResourceFieldUsage {
  const usages = extractResourceFieldUsages(workflowOf(node));
  expect(usages).toHaveLength(1);
  return usages[0];
}

/** Airtable réel : mapping saisi à la main, avec la photo des colonnes de la table. */
const airtableUpdate: N8nNode = {
  name: 'Update record',
  type: 'n8n-nodes-base.airtable',
  parameters: {
    base,
    table,
    operation: 'update',
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: ['id'],
      value: { id: '={{ $json.id }}', Statut: 'OK' },
      schema: [
        { id: 'id', displayName: 'id', type: 'string', readOnly: true, required: false },
        { id: 'Statut', displayName: 'Statut', type: 'string', required: false },
        { id: 'Owner', displayName: 'Owner', type: 'string', required: true, removed: true },
      ],
    },
  },
};

/** Airtable réel : lecture avec sélection explicite de colonnes. */
const airtableSearch: N8nNode = {
  name: 'Search prospects',
  type: 'n8n-nodes-base.airtable',
  parameters: {
    base,
    table,
    operation: 'search',
    options: { fields: ['Name', 'Phone number', 'Email'] },
  },
};

/** NocoDB réel : vieille forme à paires nom/valeur, sans photo des colonnes. */
const nocodbCreate: N8nNode = {
  name: 'Create contact',
  type: 'n8n-nodes-base.nocoDb',
  parameters: {
    operation: 'create',
    projectId: 'p8r3b',
    table: 'm2pyc',
    fieldsUi: {
      fieldValues: [
        { fieldName: 'Nom', fieldValue: '={{ $json.last }}' },
        { fieldName: 'Email', fieldValue: '={{ $json.mail }}' },
      ],
    },
  },
};

describe('resource-fields — extraction', () => {
  it("lit le mapping figé d'une écriture, ses clés de rapprochement et la photo des colonnes", () => {
    const usage = usageOf(airtableUpdate);
    expect(usage).toMatchObject({
      resourceKey: KEY,
      nodeName: 'Update record',
      access: 'write',
      operation: 'update',
      fields: ['id', 'Statut'],
      matchingColumns: ['id'],
      dynamicTable: false,
      understood: true,
    });
    expect(usage.knownColumns).toEqual([
      { name: 'id', required: false, readOnly: true, mapped: true },
      { name: 'Statut', required: false, readOnly: false, mapped: true },
      { name: 'Owner', required: true, readOnly: false, mapped: false },
    ]);
  });

  it("lit la sélection de colonnes d'une lecture", () => {
    expect(usageOf(airtableSearch)).toMatchObject({
      access: 'read',
      fields: ['Name', 'Phone number', 'Email'],
      understood: true,
    });
  });

  it('lit les paires nom/valeur des nœuds sans resourceMapper', () => {
    const usage = usageOf(nocodbCreate);
    expect(usage).toMatchObject({
      resourceKey: 'nocodb:p8r3b/m2pyc',
      access: 'write',
      fields: ['Nom', 'Email'],
      understood: true,
    });
    // pas de photo des colonnes sur cette forme : on ne saura rien du « requis »
    expect(usage.knownColumns).toBeUndefined();
  });

  it("ne retient aucune liste sous « Map Automatically », même si l'ancien mapping traîne", () => {
    const usage = usageOf({
      ...airtableUpdate,
      parameters: {
        ...airtableUpdate.parameters,
        columns: { ...(airtableUpdate.parameters!.columns as object), mappingMode: 'autoMapInputData' },
      },
    });
    expect(usage.fields).toBeUndefined();
    // la photo des colonnes, elle, reste exploitable
    expect(usage.knownColumns).toHaveLength(3);
  });

  it("reconnaît l'auto-mapping des nœuds sans resourceMapper", () => {
    const usage = usageOf({
      ...nocodbCreate,
      parameters: { operation: 'create', projectId: 'p8r3b', table: 'm2pyc', dataToSend: 'autoMapInputData' },
    });
    expect(usage).toMatchObject({ access: 'write', understood: true });
    expect(usage.fields).toBeUndefined();
  });

  it("déduit une lecture quand le nœud ne déclare pas d'opération", () => {
    expect(
      usageOf({ ...airtableSearch, name: 'Get a record', parameters: { base, table, options: {} } }),
    ).toMatchObject({ access: 'read', operation: '', fields: undefined });
  });

  it('signale la table désignée par une expression', () => {
    const usage = usageOf({
      ...airtableSearch,
      parameters: {
        ...airtableSearch.parameters,
        table: { __rl: true, mode: 'id', value: '={{ $json.tableId }}' },
      },
    });
    expect(usage.dynamicTable).toBe(true);
  });

  it("avoue ne pas savoir lire une écriture d'une forme inconnue", () => {
    const usage = usageOf({
      name: 'X',
      type: 'n8n-nodes-base.airtable',
      parameters: { base, table, operation: 'create' },
    });
    expect(usage).toMatchObject({ access: 'write', understood: false });
    expect(usage.fields).toBeUndefined();
  });

  it('ignore les nœuds qui ne visent pas une table', () => {
    const http: N8nNode = {
      name: 'Call',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://api.example.com/x' },
    };
    expect(extractResourceFieldUsages(workflowOf(http))).toEqual([]);
  });
});

describe("resource-fields — impact d'une colonne", () => {
  it('réclame une mise à jour des nœuds dont la liste est figée', () => {
    expect(columnImpact(usageOf(airtableUpdate), 'salesRegion')).toEqual({
      impact: 'to-update',
      reason: 'mapping figé sur 2 champs : la colonne ne sera pas écrite',
    });
    expect(columnImpact(usageOf(airtableSearch), 'salesRegion')).toEqual({
      impact: 'to-update',
      reason: '3 champs sélectionnés : la colonne ne remontera pas',
    });
  });

  it('laisse tranquilles les nœuds qui suivent la table', () => {
    const readAll = usageOf({
      ...airtableSearch,
      parameters: { base, table, operation: 'search', options: {} },
    });
    expect(columnImpact(readAll, 'salesRegion').impact).toBe('no-action');
  });

  it('reconnaît une colonne déjà prise en compte, à la casse près', () => {
    expect(columnImpact(usageOf(airtableSearch), ' email ')).toEqual({
      impact: 'no-action',
      reason: 'colonne déjà sélectionnée',
    });
  });

  it("ne tranche pas sur un nœud qu'il n'a pas su lire", () => {
    const opaque = usageOf({
      name: 'X',
      type: 'n8n-nodes-base.airtable',
      parameters: { base, table, operation: 'create' },
    });
    expect(columnImpact(opaque, 'salesRegion').impact).toBe('unknown');
  });
});

describe('resource-fields — colonnes obligatoires non mappées', () => {
  it('remonte une colonne requise laissée de côté', () => {
    expect(requiredNotMapped(usageOf(airtableUpdate))).toEqual(['Owner']);
  });

  it("ne dit rien d'une lecture ni d'un nœud sans photo des colonnes", () => {
    expect(requiredNotMapped(usageOf(airtableSearch))).toEqual([]);
    expect(requiredNotMapped(usageOf(nocodbCreate))).toEqual([]);
  });
});
