import { describe, expect, it } from 'vitest';
import { activeParameters, inertParamBranches } from '../src/domain/n8n/inert-params';
import { extractFieldRefs } from '../src/domain/n8n/expression-fields';
import { extractNodeRefs } from '../src/domain/n8n/expression-refs';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

/** Nœud Airtable réel : passé en « Map Automatically », l'ancien mapping est resté. */
const airtable: N8nNode = {
  name: 'Add to Airtable',
  type: 'n8n-nodes-base.airtable',
  parameters: {
    table: { __rl: true, mode: 'list', value: 'tbl123' },
    columns: {
      mappingMode: 'autoMapInputData',
      matchingColumns: ['id'],
      value: {
        Name: `={{ $('OnOffBusiness').item.json.Nom }}`,
        'Image By Customer': `={{ $('Nœud supprimé').item.json.Image }}`,
      },
      schema: [{ id: 'Name', displayName: 'Name', type: 'string' }],
    },
  },
};

describe('inert-params', () => {
  it('écarte le mapping manuel resté sous un « Map Automatically »', () => {
    expect(inertParamBranches(airtable).map((b) => b.path)).toEqual(['$.parameters.columns.value']);
    const active = activeParameters(airtable);
    expect((active.columns as Record<string, unknown>).value).toBeUndefined();
    // le reste du nœud est intact, y compris les colonnes de correspondance
    expect((active.columns as Record<string, unknown>).matchingColumns).toEqual(['id']);
    expect(active.table).toEqual(airtable.parameters!.table);
    // et le nœud d'origine n'est pas modifié
    expect((airtable.parameters!.columns as Record<string, unknown>).value).toBeDefined();
  });

  it("garde le mapping quand il est bien celui qui s'applique", () => {
    const node: N8nNode = {
      name: 'Update',
      type: 'n8n-nodes-base.airtable',
      parameters: { columns: { mappingMode: 'defineBelow', value: { id: `={{ $json.recordId }}` } } },
    };
    expect(inertParamBranches(node)).toEqual([]);
    expect(activeParameters(node)).toEqual(node.parameters);
  });

  it('tranche entre les deux modes du nœud Set', () => {
    const raw: N8nNode = {
      name: 'Set',
      type: 'n8n-nodes-base.set',
      parameters: { mode: 'raw', jsonOutput: '={{ $json.a }}', assignments: { assignments: [] } },
    };
    expect(inertParamBranches(raw).map((b) => b.path)).toEqual(['$.parameters.assignments']);
    const manual: N8nNode = {
      name: 'Set',
      type: 'n8n-nodes-base.set',
      parameters: { jsonOutput: '={{ $json.a }}', assignments: { assignments: [] } },
    };
    expect(inertParamBranches(manual).map((b) => b.path)).toEqual(['$.parameters.jsonOutput']);
  });

  it('tranche entre les sections envoyées ou non par HTTP Request', () => {
    const node: N8nNode = {
      name: 'HTTP',
      type: 'n8n-nodes-base.httpRequest',
      parameters: {
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.payload }}',
        bodyParameters: { parameters: [] },
        queryParameters: { parameters: [] },
        headerParameters: { parameters: [] },
      },
    };
    expect(inertParamBranches(node).map((b) => b.path)).toEqual([
      '$.parameters.bodyParameters',
      '$.parameters.queryParameters',
      '$.parameters.headerParameters',
    ]);
  });

  it('tranche entre les langages du nœud Code', () => {
    const python: N8nNode = {
      name: 'Code',
      type: 'n8n-nodes-base.code',
      parameters: { language: 'python', pythonCode: 'x', jsCode: 'y' },
    };
    expect(inertParamBranches(python).map((b) => b.path)).toEqual(['$.parameters.jsCode']);
    const js: N8nNode = {
      name: 'Code',
      type: 'n8n-nodes-base.code',
      parameters: { jsCode: 'y', pythonCode: 'x' },
    };
    expect(inertParamBranches(js).map((b) => b.path)).toEqual(['$.parameters.pythonCode']);
  });
});

describe('analyses en aval', () => {
  const workflow: N8nWorkflow = {
    name: 'wf',
    nodes: [{ name: 'OnOffBusiness', type: 'n8n-nodes-base.set' }, airtable],
    connections: {
      OnOffBusiness: { main: [[{ node: 'Add to Airtable', type: 'main', index: 0 }]] },
    },
  };

  it('ne référence plus aucun champ du mapping mort', () => {
    expect(extractFieldRefs(workflow)).toEqual([]);
  });

  it('ne référence plus le nœud supprimé cité par le mapping mort', () => {
    expect(extractNodeRefs(activeParameters(airtable))).toEqual([]);
  });
});
