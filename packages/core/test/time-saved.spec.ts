import { describe, expect, it } from 'vitest';
import { estimateTimeSaved } from '../src/domain/n8n/time-saved';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function node(partial: Partial<N8nNode> & Pick<N8nNode, 'name' | 'type'>): N8nNode {
  return { parameters: {}, position: [0, 0], typeVersion: 1, ...partial } as N8nNode;
}

function workflow(nodes: N8nNode[]): N8nWorkflow {
  return { id: 'w1', name: 'W', nodes, connections: {} } as unknown as N8nWorkflow;
}

describe('estimateTimeSaved', () => {
  it('ne compte ni le déclencheur ni la plomberie', () => {
    const estimate = estimateTimeSaved(
      workflow([
        node({ name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger' }),
        node({ name: 'Set', type: 'n8n-nodes-base.set' }),
        node({ name: 'Merge', type: 'n8n-nodes-base.merge' }),
      ]),
    );
    expect(estimate.minutes).toBe(0);
    expect(estimate.reason).toContain('câblage');
  });

  it('compte une écriture plus cher qu’une lecture', () => {
    const write = estimateTimeSaved(
      workflow([
        node({ name: 'Ajout', type: 'n8n-nodes-base.airtable', parameters: { operation: 'create' } }),
      ]),
    );
    const read = estimateTimeSaved(
      workflow([
        node({ name: 'Recherche', type: 'n8n-nodes-base.airtable', parameters: { operation: 'search' } }),
      ]),
    );
    expect(write.minutes).toBeGreaterThan(read.minutes);
    expect(read.minutes).toBeGreaterThan(0);
  });

  it('ne compte pas un appel de sous-workflow (compté chez l’appelé)', () => {
    const estimate = estimateTimeSaved(
      workflow([node({ name: 'Appel', type: 'n8n-nodes-base.executeWorkflow' })]),
    );
    expect(estimate.minutes).toBe(0);
  });

  it('ignore un nœud désactivé', () => {
    const estimate = estimateTimeSaved(
      workflow([node({ name: 'Mail', type: 'n8n-nodes-base.gmail', disabled: true })]),
    );
    expect(estimate.minutes).toBe(0);
  });

  it('donne son geste le plus cher au modèle de langage', () => {
    const estimate = estimateTimeSaved(
      workflow([node({ name: 'Modèle', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi' })]),
    );
    expect(estimate.minutes).toBe(5);
    expect(estimate.reason).toContain('passage IA');
  });

  it('ne suit pas le nombre de nœuds : dix écritures ne valent pas dix fois une', () => {
    const one = estimateTimeSaved(
      workflow([node({ name: 'A', type: 'n8n-nodes-base.airtable', parameters: { operation: 'create' } })]),
    );
    const many = estimateTimeSaved(
      workflow(
        Array.from({ length: 10 }, (_, i) =>
          node({ name: `A${i}`, type: 'n8n-nodes-base.airtable', parameters: { operation: 'create' } }),
        ),
      ),
    );
    expect(many.minutes).toBeLessThanOrEqual(one.minutes * 3);
  });

  it('un gros workflow de tri de mails reste à quelques minutes', () => {
    const nodes = [
      ...Array.from({ length: 12 }, (_, i) =>
        node({ name: `Lire ${i}`, type: 'n8n-nodes-base.gmail', parameters: { operation: 'get' } }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        node({ name: `IA ${i}`, type: '@n8n/n8n-nodes-langchain.lmChatOpenAi' }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        node({ name: `Label ${i}`, type: 'n8n-nodes-base.gmail', parameters: { operation: 'addLabels' } }),
      ),
    ];
    expect(estimateTimeSaved(workflow(nodes)).minutes).toBeLessThanOrEqual(30);
  });

  it('plafonne, et le dit', () => {
    const types = [
      ['n8n-nodes-base.airtable', { operation: 'create' }],
      ['n8n-nodes-base.gmail', { operation: 'send' }],
      ['n8n-nodes-base.airtable', { operation: 'search' }],
      ['@n8n/n8n-nodes-langchain.lmChatOpenAi', {}],
      ['n8n-nodes-base.if', {}],
      ['n8n-nodes-base.code', {}],
    ] as const;
    const nodes = types.flatMap(([type, parameters], t) =>
      Array.from({ length: 10 }, (_, i) => node({ name: `N${t}-${i}`, type, parameters })),
    );
    const estimate = estimateTimeSaved(workflow(nodes));
    expect(estimate.minutes).toBe(30);
    expect(estimate.capped).toBe(true);
  });
});
