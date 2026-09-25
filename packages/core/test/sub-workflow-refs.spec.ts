import { describe, expect, it } from 'vitest';
import { extractSubWorkflowRefs, remapSubWorkflowRefs } from '../src/domain/n8n/sub-workflow-refs';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(nodes: Array<Record<string, unknown>>): N8nWorkflow {
  return { name: 'WF', nodes, connections: {} } as unknown as N8nWorkflow;
}

const executeNode = {
  name: 'Execute Workflow',
  type: 'n8n-nodes-base.executeWorkflow',
  parameters: {
    workflowId: { __rl: true, mode: 'list', value: 'child-1', cachedResultName: 'Enrichissement' },
  },
};

describe('sub-workflow-refs', () => {
  it('lit le sous-workflow appelé, resourceLocator ou id nu', () => {
    const refs = extractSubWorkflowRefs(
      workflowWith([
        executeNode,
        {
          name: 'Outil',
          type: '@n8n/n8n-nodes-langchain.toolWorkflow',
          parameters: { workflowId: 'child-2' },
        },
      ]),
    );
    expect(refs).toEqual([
      {
        nodeName: 'Execute Workflow',
        kind: 'execute',
        externalId: 'child-1',
        label: 'Enrichissement',
        dynamic: false,
        disabled: false,
      },
      {
        nodeName: 'Outil',
        kind: 'tool',
        externalId: 'child-2',
        label: undefined,
        dynamic: false,
        disabled: false,
      },
    ]);
  });

  it('ignore le trigger de sous-workflow, qui est l’entrée de l’appelé', () => {
    const refs = extractSubWorkflowRefs(
      workflowWith([
        {
          name: 'When Executed',
          type: 'n8n-nodes-base.executeWorkflowTrigger',
          parameters: { workflowId: 'x' },
        },
      ]),
    );
    expect(refs).toEqual([]);
  });

  it('marque dynamique un id construit par expression', () => {
    const refs = extractSubWorkflowRefs(
      workflowWith([
        {
          name: 'Dispatch',
          type: 'n8n-nodes-base.executeWorkflow',
          parameters: { workflowId: '={{ $json.wf }}' },
        },
      ]),
    );
    expect(refs[0]).toMatchObject({ dynamic: true });
  });

  it('réécrit l’id et le nom affiché, sans toucher aux autres nœuds', () => {
    const workflow = workflowWith([
      executeNode,
      { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://x/child-1' } },
    ]);
    const { workflow: result, rewrites } = remapSubWorkflowRefs(
      workflow,
      new Map([['child-1', { externalId: 'child-1-dev', name: 'Enrichissement - DEV' }]]),
    );

    expect(rewrites).toEqual([{ nodeName: 'Execute Workflow', from: 'child-1', to: 'child-1-dev' }]);
    expect(result.nodes[0].parameters?.workflowId).toEqual({
      __rl: true,
      mode: 'list',
      value: 'child-1-dev',
      cachedResultName: 'Enrichissement - DEV',
    });
    // L'URL qui contient la même chaîne n'est pas un appel de sous-workflow.
    expect(result.nodes[1].parameters?.url).toBe('https://x/child-1');
    // L'original n'est jamais modifié.
    expect(workflow.nodes[0].parameters?.workflowId).toMatchObject({ value: 'child-1' });
  });

  it('ne réécrit rien quand la cible est déjà la bonne', () => {
    const { rewrites } = remapSubWorkflowRefs(
      workflowWith([executeNode]),
      new Map([['child-1', { externalId: 'child-1' }]]),
    );
    expect(rewrites).toEqual([]);
  });
});
