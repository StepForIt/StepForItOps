import { describe, expect, it } from 'vitest';
import { relabelResourceLocators, withEnvMark } from '../src/domain/n8n/resource-locator-labels';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(parameters: Record<string, unknown>): N8nWorkflow {
  return {
    name: 'WF',
    nodes: [{ name: 'NocoDB', type: 'n8n-nodes-base.nocoDb', parameters }],
    connections: {},
  } as unknown as N8nWorkflow;
}

const locator = (value: string, cachedResultName: string) => ({
  __rl: true,
  mode: 'list',
  value,
  cachedResultName,
});

describe('resource-locator-labels', () => {
  it('pose le vrai titre quand le mapping le connaît', () => {
    const { workflow, relabeled } = relabelResourceLocators(
      workflowWith({ projectId: locator('p-dev', 'CRM') }),
      new Map([['p-dev', 'CRM (dev)']]),
      'dev',
    );
    expect(relabeled).toEqual([{ nodeName: 'NocoDB', from: 'CRM', to: 'CRM (dev)' }]);
    expect(workflow.nodes[0].parameters?.projectId).toMatchObject({ cachedResultName: 'CRM (dev)' });
  });

  it('estampille l’env quand le titre est inconnu', () => {
    const { workflow } = relabelResourceLocators(
      workflowWith({ projectId: locator('p-prod', 'CRM') }),
      new Map(),
      'prod',
    );
    expect(workflow.nodes[0].parameters?.projectId).toMatchObject({ cachedResultName: 'CRM (prod)' });
  });

  it('n’empile pas les estampilles au fil des bascules', () => {
    expect(withEnvMark('CRM (dev)', 'prod')).toBe('CRM (prod)');
    expect(withEnvMark('CRM', 'dev')).toBe('CRM (dev)');
  });

  it('ne touche qu’aux ressources dont l’id a changé', () => {
    const { workflow, relabeled } = relabelResourceLocators(
      workflowWith({ projectId: locator('p-dev', 'CRM'), tableId: locator('t-inchangée', 'Contacts') }),
      new Map(),
      'dev',
      new Set(['p-dev']),
    );
    expect(relabeled).toHaveLength(1);
    expect(workflow.nodes[0].parameters?.tableId).toMatchObject({ cachedResultName: 'Contacts' });
  });

  it('laisse intact un paramètre qui n’est pas un resourceLocator', () => {
    const { workflow, relabeled } = relabelResourceLocators(
      workflowWith({ url: 'https://exemple/p-dev' }),
      new Map([['p-dev', 'CRM (dev)']]),
      'dev',
    );
    expect(relabeled).toEqual([]);
    expect(workflow.nodes[0].parameters?.url).toBe('https://exemple/p-dev');
  });
});
