import { describe, expect, it } from 'vitest';
import { collectExecutionSamples } from '../src/domain/n8n/execution-samples';
import { extractFieldRefs, extractFieldRefsFromString } from '../src/domain/n8n/expression-fields';
import { checkFieldRefs, closestField } from '../src/domain/n8n/field-check';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

/** Exécution n8n minimale : un nœud « Sales » qui sort deux champs. */
function execution(json: Record<string, unknown>, node = 'Sales') {
  return {
    data: {
      resultData: {
        runData: { [node]: [{ data: { main: [[{ json }]] } }] },
      },
    },
  };
}

describe('execution-samples', () => {
  it('unionne les champs vus sur plusieurs exécutions (branches différentes)', () => {
    const samples = collectExecutionSamples([
      execution({ salesFirstName: 'Ada', customer: { email: 'a@b.c' } }),
      execution({ salesFirstName: 'Alan', invoiceId: 42 }),
    ]);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ node: 'Sales', executions: 2, items: 2 });
    expect(samples[0].fields).toEqual(['customer', 'customer.email', 'invoiceId', 'salesFirstName']);
  });

  it('accepte data en chaîne JSON et ignore un JSON inattendu', () => {
    const asString = { data: JSON.stringify(execution({ a: 1 }).data) };
    expect(collectExecutionSamples([asString])[0].fields).toEqual(['a']);
    expect(collectExecutionSamples([{ data: 'pas du json' }, {}])).toEqual([]);
  });
});

describe('expression-fields', () => {
  it('extrait le champ pour chaque forme de référence', () => {
    expect(extractFieldRefsFromString(`={{ $('Sales').item.json.salesFistName }}`)).toEqual([
      { source: 'Sales', path: 'salesFistName' },
    ]);
    expect(extractFieldRefsFromString(`={{ $node["Sales"].json.customer.email }}`)).toEqual([
      { source: 'Sales', path: 'customer.email' },
    ]);
    expect(extractFieldRefsFromString(`={{ $('Sales').first().json["Sent to sellsy"] }}`)).toEqual([
      { source: 'Sales', path: 'Sent to sellsy' },
    ]);
    // $json / $input : source non résolue à ce stade
    expect(extractFieldRefsFromString(`={{ $json.total }} {{ $input.first().json.x }}`)).toEqual([
      { source: null, path: 'total' },
      { source: null, path: 'x' },
    ]);
  });

  it('coupe le chemin au premier appel ou index', () => {
    expect(extractFieldRefsFromString(`={{ $('S').item.json.lines[0].sku }}`)).toEqual([
      { source: 'S', path: 'lines' },
    ]);
    expect(extractFieldRefsFromString(`={{ $('S').item.json.name.toUpperCase() }}`)).toEqual([
      { source: 'S', path: 'name' },
    ]);
    expect(extractFieldRefsFromString(`={{ $('S').item.json }}`)).toEqual([]);
  });

  it('résout $json via le parent unique et ignore les nœuds à parents multiples', () => {
    const workflow: N8nWorkflow = {
      name: 'wf',
      nodes: [
        { name: 'Sales', type: 'n8n-nodes-base.set' },
        { name: 'Other', type: 'n8n-nodes-base.set' },
        { name: 'Mail', type: 'n8n-nodes-base.gmail', parameters: { text: '={{ $json.salesFistName }}' } },
        { name: 'Merge', type: 'n8n-nodes-base.merge', parameters: { x: '={{ $json.total }}' } },
      ],
      connections: {
        Sales: {
          main: [
            [
              { node: 'Mail', type: 'main', index: 0 },
              { node: 'Merge', type: 'main', index: 0 },
            ],
          ],
        },
        Other: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
      },
    };
    expect(extractFieldRefs(workflow)).toEqual([
      { source: 'Sales', path: 'salesFistName', node: 'Mail', at: '$.parameters.text' },
    ]);
  });
});

describe('field-check', () => {
  it('propose le champ le plus proche (faute de frappe, casse)', () => {
    expect(closestField('salesFistName', ['salesFirstName', 'invoiceId'])).toBe('salesFirstName');
    expect(closestField('salesfirstname', ['salesFirstName'])).toBe('salesFirstName');
    expect(closestField('firstName', ['lastName'])).toBeUndefined();
    // profondeur différente : pas de suggestion croisée
    expect(closestField('email', ['customer.email'])).toBeUndefined();
  });

  it('remonte une erreur sur la faute de frappe et un warning sur un champ inconnu', () => {
    const samples = collectExecutionSamples([execution({ salesFirstName: 'Ada' })]);
    const refs = [
      { source: 'Sales', path: 'salesFistName', node: 'Mail', at: '$.parameters.text' },
      { source: 'Sales', path: 'zzTotallyUnknown', node: 'Mail', at: '$.parameters.subject' },
      { source: 'Sales', path: 'salesFirstName', node: 'Mail', at: '$.parameters.cc' },
      { source: 'Jamais exécuté', path: 'peuImporte', node: 'Mail', at: '$.parameters.bcc' },
    ];
    const findings = checkFieldRefs(refs, samples);
    expect(findings.map((f) => [f.code, f.severity])).toEqual([
      ['field-typo', 'error'],
      ['field-unknown', 'warning'],
    ]);
    expect(findings[0].data.suggestion).toBe('salesFirstName');
    expect(findings[0].message).toContain('salesFirstName');
  });

  it('ne juge pas un chemin dont seul le parent a été aplati', () => {
    const samples = collectExecutionSamples([execution({ payload: { a: { b: { c: { deep: 1 } } } } })]);
    const refs = [{ source: 'Sales', path: 'payload.a.b.c.deep', node: 'Mail', at: '$.parameters.x' }];
    expect(checkFieldRefs(refs, samples)).toEqual([]);
  });
});
