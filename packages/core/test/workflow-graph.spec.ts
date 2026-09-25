import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { WorkflowGraph, hasTrigger, workflowTriggerKinds } from '../src/domain/n8n/workflow-graph';

const wf: N8nWorkflow = {
  name: 'test',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
    { name: 'Set', type: 'n8n-nodes-base.set' },
    { name: 'HTTP', type: 'n8n-nodes-base.httpRequest' },
    { name: 'Orphan', type: 'n8n-nodes-base.set' },
    { name: 'Sticky Note13', type: 'n8n-nodes-base.stickyNote' },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
    Set: { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
    HTTP: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] },
  },
};

describe('WorkflowGraph', () => {
  it('computes ancestors transitively', () => {
    const graph = new WorkflowGraph(wf);
    expect(graph.ancestorsOf('HTTP')).toEqual(new Set(['Set', 'Webhook']));
  });

  it('detects orphan nodes but ignores sticky notes', () => {
    const graph = new WorkflowGraph(wf);
    expect(graph.orphanNodes()).toEqual(['Orphan']);
  });

  it('isole les connexions résiduelles au lieu d’en faire des arêtes', () => {
    const graph = new WorkflowGraph(wf);
    expect(graph.danglingEdges.map((e) => e.to)).toEqual(['Ghost']);
    expect(graph.edges.map((e) => e.to)).toEqual(['Set', 'HTTP']);
  });

  it('detects triggers', () => {
    expect(hasTrigger(wf)).toBe(true);
    expect(hasTrigger({ ...wf, nodes: [{ name: 'Set', type: 'n8n-nodes-base.set' }] })).toBe(false);
  });

  it('liste les façons de démarrer un workflow', () => {
    const raw = {
      name: 'Multi',
      nodes: [
        { name: 'Appelé', type: 'n8n-nodes-base.executeWorkflowTrigger' },
        { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger' },
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { name: 'Telegram', type: 'n8n-nodes-base.telegramTrigger' },
        // Répond à une exécution, n'en démarre aucune.
        { name: 'Respond', type: 'n8n-nodes-base.respondToWebhook' },
        // Désactivé : ne démarre rien.
        { name: 'Form', type: 'n8n-nodes-base.formTrigger', disabled: true },
        { name: 'Set', type: 'n8n-nodes-base.set' },
      ],
      connections: {},
    } as unknown as N8nWorkflow;

    expect(workflowTriggerKinds(raw)).toEqual(['schedule', 'webhook', 'app', 'sub-workflow']);
  });

  it('repère un workflow qui ne tourne que quand un autre l’appelle', () => {
    const called = {
      name: 'Enfant',
      nodes: [{ name: 'Appelé', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
      connections: {},
    } as unknown as N8nWorkflow;
    expect(workflowTriggerKinds(called)).toEqual(['sub-workflow']);
  });

  it('ne renvoie aucun déclencheur quand plus rien ne peut lancer le workflow', () => {
    const raw = {
      name: 'Mort',
      nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook', disabled: true }],
      connections: {},
    } as unknown as N8nWorkflow;
    expect(workflowTriggerKinds(raw)).toEqual([]);
  });

  it('tient un contenu sans `nodes` (JSON tronqué, autre plateforme) au lieu de lever', () => {
    const graph = new WorkflowGraph({ name: 'Scénario Make' } as unknown as N8nWorkflow);
    expect(graph.nodeNames.size).toBe(0);
    expect(graph.edges).toEqual([]);
  });
});
