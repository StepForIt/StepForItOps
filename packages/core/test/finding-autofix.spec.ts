import { describe, expect, it } from 'vitest';
import { autoFixOperations, markAutoFixable } from '../src/domain/n8n/finding-autofix';
import { runLoopWiringChecks } from '../src/domain/n8n/loop-wiring';
import { applyEditOperations } from '../src/domain/n8n/workflow-edit';
import { N8nConnections, N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function wf(nodes: Array<Partial<N8nNode>>, connections: N8nConnections): N8nWorkflow {
  return {
    name: 'Test',
    nodes: nodes.map((n, i) => ({
      name: n.name ?? `Node ${i}`,
      type: n.type ?? 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
      ...n,
    })) as N8nNode[],
    connections,
  };
}

const LOOP: Partial<N8nNode> = { name: 'Loop', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3 };

function main(...outputs: Array<string[]>): N8nConnections[string] {
  return { main: outputs.map((targets) => targets.map((node) => ({ node, type: 'main', index: 0 }))) };
}

/** Le correctif rejoué sur le workflow : le finding visé doit avoir disparu. */
function fixed(workflow: N8nWorkflow, code: string): N8nWorkflow {
  const ops = autoFixOperations(workflow, { code, nodeName: 'Loop' });
  expect(ops).not.toBeNull();
  return applyEditOperations(workflow, ops!).workflow;
}

describe('autoFixOperations — boucles', () => {
  it('déplace le corps de « done » vers « loop »', () => {
    const workflow = wf([LOOP, { name: 'Traiter' }], {
      Loop: main(['Traiter']),
      Traiter: main(['Loop']),
    });
    const after = fixed(workflow, 'loop-body-on-done');
    expect(runLoopWiringChecks(after)).toEqual([]);
    expect(after.connections.Loop.main[0]).toEqual([]);
    expect(after.connections.Loop.main[1]).toEqual([{ node: 'Traiter', type: 'main', index: 0 }]);
  });

  it('laisse sur « done » ce qui ne revient pas sur la boucle', () => {
    const workflow = wf([LOOP, { name: 'Traiter' }, { name: 'Suite' }], {
      Loop: main(['Traiter', 'Suite']),
      Traiter: main(['Loop']),
    });
    const after = fixed(workflow, 'loop-body-on-done');
    expect(after.connections.Loop.main[0]).toEqual([{ node: 'Suite', type: 'main', index: 0 }]);
    expect(after.connections.Loop.main[1]).toEqual([{ node: 'Traiter', type: 'main', index: 0 }]);
  });

  it('ne devine pas quand rien ne prouve où est le corps', () => {
    const workflow = wf([LOOP, { name: 'Suite' }], { Loop: main(['Suite']) });
    expect(autoFixOperations(workflow, { code: 'loop-body-on-done', nodeName: 'Loop' })).toBeNull();
  });

  it('referme la boucle sur son unique bout', () => {
    const workflow = wf([LOOP, { name: 'A' }, { name: 'B' }, { name: 'Suite' }], {
      Loop: main(['Suite'], ['A']),
      A: main(['B']),
    });
    const after = fixed(workflow, 'loop-not-closed');
    expect(runLoopWiringChecks(after)).toEqual([]);
    expect(after.connections.B.main[0]).toEqual([{ node: 'Loop', type: 'main', index: 0 }]);
  });

  it('ne choisit pas entre deux bouts possibles', () => {
    const workflow = wf([LOOP, { name: 'A' }, { name: 'B' }, { name: 'C' }], {
      Loop: main([], ['A']),
      A: main(['B', 'C']),
    });
    expect(autoFixOperations(workflow, { code: 'loop-not-closed', nodeName: 'Loop' })).toBeNull();
  });
});

describe('autoFixOperations — sous-clé de collection', () => {
  const notion = (fileUrls: unknown) =>
    wf(
      [
        {
          name: 'Notion',
          type: 'n8n-nodes-base.notion',
          parameters: {
            resource: 'databasePage',
            propertiesUi: { propertyValues: [{ key: 'Fichiers|files', fileUrls }] },
          },
        },
      ],
      {},
    );
  const finding = (expectedKeys: string[]) => ({
    code: 'node-unknown-collection-key',
    nodeName: 'Notion',
    data: {
      path: 'propertiesUi.propertyValues[].fileUrls',
      unknownKeys: ['values'],
      expectedKeys,
    },
  });

  it('renomme la clé fautive en l’unique nom déclaré, sans toucher au reste', () => {
    const workflow = notion({ values: [{ url: 'https://x' }] });
    const ops = autoFixOperations(workflow, finding(['fileUrl']));
    const after = applyEditOperations(workflow, ops!).workflow;
    expect(after.nodes[0].parameters).toEqual({
      resource: 'databasePage',
      propertiesUi: {
        propertyValues: [{ key: 'Fichiers|files', fileUrls: { fileUrl: [{ url: 'https://x' }] } }],
      },
    });
  });

  it('ne choisit pas entre plusieurs noms déclarés', () => {
    expect(autoFixOperations(notion({ values: [] }), finding(['fileUrl', 'other']))).toBeNull();
  });

  it('ne fusionne pas avec une clé déjà présente', () => {
    expect(autoFixOperations(notion({ values: [], fileUrl: [] }), finding(['fileUrl']))).toBeNull();
  });

  it('se tait quand le nœud a changé depuis l’analyse', () => {
    expect(autoFixOperations(notion({ fileUrl: [] }), finding(['fileUrl']))).toBeNull();
  });
});

describe('markAutoFixable', () => {
  it('ne marque que ce qui se corrige seul', () => {
    const workflow = wf([LOOP, { name: 'Traiter' }], { Loop: main(['Traiter']), Traiter: main(['Loop']) });
    const marked = markAutoFixable(workflow, [
      { code: 'loop-body-on-done', nodeName: 'Loop', data: { suggestion: 's' } },
      { code: 'http-no-timeout', nodeName: 'Loop' },
    ]);
    expect(marked[0].data).toEqual({ suggestion: 's', autoFix: true });
    expect(marked[1].data).toBeUndefined();
  });
});
