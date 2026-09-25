import { describe, expect, it } from 'vitest';
import { adoptTargetLocators, canonicalLocatorNode } from '../src/domain/n8n/resource-locator-form';
import { diffWorkflows } from '../src/domain/n8n/workflow-diff';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function airtable(base: Record<string, unknown>, name = 'Get a record'): N8nNode {
  return {
    id: 'n1',
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position: [0, 0],
    parameters: {
      base: { __rl: true, ...base },
      table: {
        __rl: true,
        mode: 'list',
        value: 'tblX0ebYB53kEqP0A',
        cachedResultUrl: 'https://airtable.com/appPRE/tblX0ebYB53kEqP0A',
        cachedResultName: 'Prospect',
      },
    },
  };
}

const workflow = (node: N8nNode): N8nWorkflow => ({ name: 'Set SMS', nodes: [node], connections: {} });

/** Le cas rencontré : la dev tape l'id en expression, la preprod l'a choisi dans la liste. */
const typedInDev = airtable({ mode: 'id', value: '=appPRE' });
const pickedInPreprod = airtable({
  mode: 'list',
  value: 'appPRE',
  cachedResultUrl: 'https://airtable.com/appPRE',
  cachedResultName: 'CRM (preprod)',
});

describe('canonicalLocatorNode', () => {
  it('confond un id tapé en expression sans gabarit et le même id choisi dans la liste', () => {
    expect(canonicalLocatorNode(typedInDev)).toEqual(canonicalLocatorNode(pickedInPreprod));
  });

  it('garde une expression qui calcule quelque chose', () => {
    const computed = airtable({ mode: 'id', value: '={{ $json.base }}' });
    expect(canonicalLocatorNode(computed)).not.toEqual(canonicalLocatorNode(pickedInPreprod));
  });

  it('ne confond pas deux ressources différentes', () => {
    expect(canonicalLocatorNode(airtable({ mode: 'id', value: 'appAUTRE' }))).not.toEqual(
      canonicalLocatorNode(pickedInPreprod),
    );
  });

  it('ne confond pas une url avec un id', () => {
    const byUrl = airtable({ mode: 'url', value: 'appPRE' });
    expect(canonicalLocatorNode(byUrl)).not.toEqual(canonicalLocatorNode(pickedInPreprod));
  });
});

describe('diffWorkflows avec compareAs', () => {
  it('ne compte pas une réécriture du sélecteur comme une modification', () => {
    const diff = diffWorkflows(workflow(pickedInPreprod), workflow(typedInDev), {
      compareAs: canonicalLocatorNode,
    });
    expect(diff.hasChanges).toBe(false);
  });

  it('sans elle, la même réécriture reste une modification', () => {
    expect(diffWorkflows(workflow(pickedInPreprod), workflow(typedInDev)).counts.modified).toBe(1);
  });
});

describe('adoptTargetLocators', () => {
  it('reprend l’écriture de la cible quand la ressource visée est la même', () => {
    const { workflow: adopted, adopted: count } = adoptTargetLocators(
      workflow(typedInDev),
      workflow(pickedInPreprod),
    );
    expect(adopted.nodes[0].parameters).toEqual(pickedInPreprod.parameters);
    expect(count).toBe(1);
    expect(diffWorkflows(workflow(pickedInPreprod), adopted).hasChanges).toBe(false);
  });

  it('laisse la ressource du candidat quand elle change', () => {
    const other = airtable({ mode: 'id', value: 'appAUTRE' });
    const { workflow: adopted } = adoptTargetLocators(workflow(other), workflow(pickedInPreprod));
    expect(adopted.nodes[0].parameters?.['base']).toEqual(other.parameters?.['base']);
  });

  it('ne touche pas un nœud absent de la cible ou d’un autre type', () => {
    const renamed = airtable({ mode: 'id', value: '=appPRE' }, 'Autre nœud');
    expect(adoptTargetLocators(workflow(renamed), workflow(pickedInPreprod)).adopted).toBe(0);
    const set = { ...pickedInPreprod, type: 'n8n-nodes-base.set' };
    expect(adoptTargetLocators(workflow(typedInDev), workflow(set)).adopted).toBe(0);
  });

  it('ne fait rien sans cible', () => {
    expect(adoptTargetLocators(workflow(typedInDev), undefined).workflow).toEqual(workflow(typedInDev));
  });
});
