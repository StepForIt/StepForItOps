import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { blankTriggerName, buildBlankWorkflow, isBlankWorkflow } from '../src/domain/n8n/blank-workflow';

describe('buildBlankWorkflow', () => {
  it('creates an inactive workflow with a single manual trigger', () => {
    const workflow = buildBlankWorkflow('Relance devis');
    expect(workflow.name).toBe('Relance devis');
    expect(workflow.active).toBe(false);
    expect(workflow.nodes).toHaveLength(1);
    expect(workflow.nodes[0].name).toBe(blankTriggerName());
    expect(workflow.connections).toEqual({});
  });

  it('produces a workflow recognised as blank', () => {
    expect(isBlankWorkflow(buildBlankWorkflow('Relance devis'))).toBe(true);
  });
});

describe('isBlankWorkflow', () => {
  const workflow = (partial: Partial<N8nWorkflow>): N8nWorkflow => ({
    name: 'X',
    nodes: [],
    connections: {},
    ...partial,
  });

  it('accepts a workflow without any node', () => {
    expect(isBlankWorkflow(workflow({}))).toBe(true);
  });

  it('rejects a workflow whose single node does something', () => {
    const nodes = [{ name: 'Appel API', type: 'n8n-nodes-base.httpRequest' }];
    expect(isBlankWorkflow(workflow({ nodes }))).toBe(false);
  });

  it('rejects a trigger already wired to a next step', () => {
    const nodes = [
      { name: blankTriggerName(), type: 'n8n-nodes-base.manualTrigger' },
      { name: 'Appel API', type: 'n8n-nodes-base.httpRequest' },
    ];
    const connections = {
      [blankTriggerName()]: { main: [[{ node: 'Appel API', type: 'main', index: 0 }]] },
    };
    expect(isBlankWorkflow(workflow({ nodes, connections }))).toBe(false);
  });
});
