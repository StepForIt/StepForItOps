import { describe, expect, it } from 'vitest';
import { checkWorkflowIntegrity } from '../src/domain/n8n/workflow-integrity';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function wf(nodes: Array<Partial<N8nWorkflow['nodes'][number]>>, connections = {}): N8nWorkflow {
  return {
    id: 'w',
    name: 'W',
    nodes: nodes.map((node, index) => ({
      id: `n${index}`,
      name: `N${index}`,
      type: 'n8n-nodes-base.set',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
      ...node,
    })) as N8nWorkflow['nodes'],
    connections,
  } as N8nWorkflow;
}

const TRIGGER = { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger' };

describe('checkWorkflowIntegrity', () => {
  it('ne reproche rien à une modification anodine', () => {
    const before = wf([TRIGGER, { name: 'Set' }]);
    const after = wf([TRIGGER, { name: 'Set', parameters: { a: 1 } }]);
    expect(checkWorkflowIntegrity(before, after)).toEqual([]);
  });

  it('refuse de vider le workflow', () => {
    const breaches = checkWorkflowIntegrity(wf([TRIGGER]), wf([]));
    expect(breaches.map((b) => b.code)).toContain('no-nodes');
  });

  it('refuse la perte du dernier déclencheur', () => {
    const breaches = checkWorkflowIntegrity(wf([TRIGGER, { name: 'Set' }]), wf([{ name: 'Set' }]));
    expect(breaches.map((b) => b.code)).toEqual(['trigger-lost']);
  });

  it('laisse passer un workflow qui n’avait déjà pas de déclencheur', () => {
    expect(checkWorkflowIntegrity(wf([{ name: 'Set' }]), wf([{ name: 'Autre' }]))).toEqual([]);
  });

  it('refuse un nœud sans type', () => {
    const breaches = checkWorkflowIntegrity(wf([TRIGGER]), wf([TRIGGER, { name: 'Vide', type: '' }]));
    expect(breaches.map((b) => b.code)).toEqual(['node-untyped']);
    expect(breaches[0].message).toContain('Vide');
  });

  it('refuse une connexion introduite vers un nœud absent', () => {
    const cassé = { Cron: { main: [[{ node: 'Fantôme', type: 'main', index: 0 }]] } };
    const breaches = checkWorkflowIntegrity(wf([TRIGGER]), wf([TRIGGER], cassé));
    expect(breaches.map((b) => b.code)).toEqual(['dangling-connection']);
    expect(breaches[0].message).toContain('Fantôme');
  });

  it('ne reproche pas une connexion pendante déjà là avant', () => {
    const cassé = { Cron: { main: [[{ node: 'Fantôme', type: 'main', index: 0 }]] } };
    expect(checkWorkflowIntegrity(wf([TRIGGER], cassé), wf([TRIGGER], cassé))).toEqual([]);
  });
});
