import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { findScopeMember, subWorkflowCalls } from '../src/domain/n8n/workflow-scope';

function workflow(nodes: N8nWorkflow['nodes']): N8nWorkflow {
  return { name: 'Racine', nodes, connections: {} } as N8nWorkflow;
}

describe('subWorkflowCalls', () => {
  it('relève les appels de sous-workflow avec le nœud qui les porte', () => {
    const calls = subWorkflowCalls(
      workflow([
        {
          name: 'Facturer',
          type: 'n8n-nodes-base.executeWorkflow',
          typeVersion: 1,
          position: [0, 0],
          parameters: { workflowId: { __rl: true, value: 'abc', cachedResultName: 'Facturation' } },
        },
      ]),
    );
    expect(calls).toEqual([
      { externalId: 'abc', nodes: ['Facturer'], label: 'Facturation', kind: 'execute' },
    ]);
  });

  it('regroupe deux nœuds qui appellent le même sous-workflow', () => {
    const node = (name: string) => ({
      name,
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1,
      position: [0, 0] as [number, number],
      parameters: { workflowId: 'abc' },
    });
    expect(subWorkflowCalls(workflow([node('A'), node('B')]))).toHaveLength(1);
    expect(subWorkflowCalls(workflow([node('A'), node('B')]))[0]!.nodes).toEqual(['A', 'B']);
  });

  // Un id construit par expression ne désigne aucune cible connue d'avance :
  // faire entrer dans le périmètre le workflow dont on a deviné l'id serait pire
  // que de n'en faire entrer aucun.
  it('écarte les appels dont l’id est une expression', () => {
    const calls = subWorkflowCalls(
      workflow([
        {
          name: 'Aiguillage',
          type: 'n8n-nodes-base.executeWorkflow',
          typeVersion: 1,
          position: [0, 0],
          parameters: { workflowId: '={{ $json.target }}' },
        },
      ]),
    );
    expect(calls).toEqual([]);
  });

  // Le trigger de sous-workflow porte « executeWorkflow » dans son type, mais il
  // est l'ENTRÉE de l'appelé : rien à suivre depuis lui.
  it('ne prend pas le déclencheur de sous-workflow pour un appel', () => {
    const calls = subWorkflowCalls(
      workflow([
        {
          name: 'Entrée',
          type: 'n8n-nodes-base.executeWorkflowTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: { workflowId: 'abc' },
        },
      ]),
    );
    expect(calls).toEqual([]);
  });
});

describe('findScopeMember', () => {
  const members = [
    { workflowId: 'w1', externalId: 'n1', name: 'Facturation', depth: 0, calledBy: [] },
    {
      workflowId: 'w2',
      externalId: 'n2',
      name: 'Envoi de la facture',
      depth: 1,
      calledBy: ['« Facturation » → Envoyer'],
    },
  ];

  it('retrouve un membre par son nom, à la casse et aux espaces près', () => {
    expect(findScopeMember(members, '  envoi de la facture ')?.workflowId).toBe('w2');
  });

  it('accepte aussi l’id n8n et l’id plateforme', () => {
    expect(findScopeMember(members, 'n2')?.workflowId).toBe('w2');
    expect(findScopeMember(members, 'w1')?.name).toBe('Facturation');
  });

  it('rend null sur un nom hors périmètre', () => {
    expect(findScopeMember(members, 'Relances')).toBeNull();
  });
});
