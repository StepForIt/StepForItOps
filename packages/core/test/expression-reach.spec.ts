import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { WorkflowGraph } from '../src/domain/n8n/workflow-graph';
import { classifyRefReach } from '../src/domain/n8n/expression-reach';
import { manualOnlyNodes } from '../src/domain/n8n/manual-branches';

function node(name: string, type = 'n8n-nodes-base.set') {
  return { name, type, position: [0, 0] as [number, number] };
}

function main(...targets: string[][]) {
  return {
    main: targets.map((names) => names.map((name) => ({ node: name, type: 'main', index: 0 }))),
  };
}

/** Trigger → Fetch → [Branche A → Utilise, Branche B]. */
const forked: N8nWorkflow = {
  name: 'forked',
  nodes: [
    node('Trigger', 'n8n-nodes-base.scheduleTrigger'),
    node('Fetch'),
    node('Branche A'),
    node('Branche B'),
    node('Utilise'),
  ],
  connections: {
    Trigger: main(['Fetch']),
    Fetch: main(['Branche A', 'Branche B']),
    'Branche A': main(['Utilise']),
  },
};

describe('classifyRefReach', () => {
  const graph = new WorkflowGraph(forked);

  it('reconnaît un ancêtre direct ou transitif', () => {
    expect(classifyRefReach(graph, 'Utilise', 'Fetch')).toBe('ancestor');
    expect(classifyRefReach(graph, 'Utilise', 'Trigger')).toBe('ancestor');
  });

  it('ne signale pas une branche sœur : les deux tournent dans la même exécution', () => {
    expect(classifyRefReach(graph, 'Utilise', 'Branche B')).toBe('parallel');
  });

  it('signale un nœud en aval', () => {
    expect(classifyRefReach(graph, 'Fetch', 'Utilise')).toBe('downstream');
  });

  it('signale les deux sorties opposées d’un IF', () => {
    const wf: N8nWorkflow = {
      name: 'if',
      nodes: [
        node('Trigger', 'n8n-nodes-base.scheduleTrigger'),
        node('Choix', 'n8n-nodes-base.if'),
        node('Vrai'),
        node('Faux'),
      ],
      connections: { Trigger: main(['Choix']), Choix: main(['Vrai'], ['Faux']) },
    };
    expect(classifyRefReach(new WorkflowGraph(wf), 'Faux', 'Vrai')).toBe('exclusive');
  });

  it('ne déclare pas exclusives deux branches d’une même sortie', () => {
    const wf: N8nWorkflow = {
      name: 'if-fanout',
      nodes: [
        node('Trigger', 'n8n-nodes-base.scheduleTrigger'),
        node('Choix', 'n8n-nodes-base.if'),
        node('A'),
        node('B'),
      ],
      connections: { Trigger: main(['Choix']), Choix: main(['A', 'B']) },
    };
    expect(classifyRefReach(new WorkflowGraph(wf), 'B', 'A')).toBe('parallel');
  });

  it('signale un nœud sans tronc commun', () => {
    const wf: N8nWorkflow = {
      name: 'deux triggers',
      nodes: [
        node('T1', 'n8n-nodes-base.webhook'),
        node('T2', 'n8n-nodes-base.scheduleTrigger'),
        node('A'),
        node('B'),
      ],
      connections: { T1: main(['A']), T2: main(['B']) },
    };
    expect(classifyRefReach(new WorkflowGraph(wf), 'B', 'A')).toBe('unrelated');
  });
});

describe('manualOnlyNodes', () => {
  it('retient la branche que seul le bouton lance', () => {
    const wf: N8nWorkflow = {
      name: 'debug',
      nodes: [
        node('Cron', 'n8n-nodes-base.scheduleTrigger'),
        node('Prod'),
        node('Manuel', 'n8n-nodes-base.manualTrigger'),
        node('Reset SMS arrays'),
      ],
      connections: { Cron: main(['Prod']), Manuel: main(['Reset SMS arrays']) },
    };
    const manual = manualOnlyNodes(wf);
    expect([...manual].sort()).toEqual(['Manuel', 'Reset SMS arrays']);
  });

  it('ne retient pas un nœud partagé avec un trigger de production', () => {
    const wf: N8nWorkflow = {
      name: 'partagé',
      nodes: [
        node('Cron', 'n8n-nodes-base.scheduleTrigger'),
        node('Manuel', 'n8n-nodes-base.manualTrigger'),
        node('Commun'),
      ],
      connections: { Cron: main(['Commun']), Manuel: main(['Commun']) },
    };
    expect(manualOnlyNodes(wf).has('Commun')).toBe(false);
  });

  it('ignore un trigger désactivé', () => {
    const wf: N8nWorkflow = {
      name: 'cron coupé',
      nodes: [
        { ...node('Cron', 'n8n-nodes-base.scheduleTrigger'), disabled: true },
        node('Manuel', 'n8n-nodes-base.manualTrigger'),
        node('Commun'),
      ],
      connections: { Cron: main(['Commun']), Manuel: main(['Commun']) },
    };
    expect(manualOnlyNodes(wf).has('Commun')).toBe(true);
  });
});
