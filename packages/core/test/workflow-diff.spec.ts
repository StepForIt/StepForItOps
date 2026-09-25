import { describe, expect, it } from 'vitest';
import { diffLines, diffWorkflows } from '../src/domain/n8n/workflow-diff';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    name: 'WF',
    nodes: [
      { id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'hook' } },
      { id: 'b', name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return items;' } },
    ],
    connections: { Webhook: { main: [[{ node: 'Code', type: 'main', index: 0 }]] } },
    ...overrides,
  };
}

describe('diffLines', () => {
  it('marque les ajouts, suppressions et le contexte', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'ctx', text: 'c' },
    ]);
  });

  it('ne renvoie que du contexte quand rien ne change', () => {
    expect(diffLines(['a', 'b'], ['a', 'b']).every((line) => line.type === 'ctx')).toBe(true);
  });
});

describe('diffWorkflows', () => {
  it('ne voit aucun changement entre deux workflows identiques', () => {
    const diff = diffWorkflows(workflow(), workflow());
    expect(diff.hasChanges).toBe(false);
    expect(diff.nodes).toHaveLength(0);
  });

  it('détecte un paramètre modifié et liste le champ concerné', () => {
    const after = workflow();
    after.nodes[1].parameters = { jsCode: 'return [];' };
    const diff = diffWorkflows(workflow(), after);

    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 1, renamed: 0 });
    expect(diff.nodes[0].name).toBe('Code');
    expect(diff.nodes[0].fields).toEqual(['parameters']);
    expect(diff.nodes[0].lines.some((line) => line.type === 'add' && line.text.includes('return [];'))).toBe(
      true,
    );
  });

  it('détecte un nœud ajouté, un nœud supprimé et le changement de nom', () => {
    const after = workflow({ name: 'WF v2' });
    after.nodes = [after.nodes[0], { id: 'c', name: 'Set', type: 'n8n-nodes-base.set', parameters: {} }];
    after.connections = { Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } };
    const diff = diffWorkflows(workflow(), after);

    expect(diff.counts).toEqual({ added: 1, removed: 1, modified: 0, renamed: 0 });
    expect(diff.nameChange).toEqual({ before: 'WF', after: 'WF v2' });
    expect(diff.connections.changed).toBe(true);
  });

  it('reconnaît un renommage (même id n8n) au lieu d’un ajout + une suppression', () => {
    const after = workflow();
    after.nodes[1] = { ...after.nodes[1], name: 'Transformation' };
    after.connections = { Webhook: { main: [[{ node: 'Transformation', type: 'main', index: 0 }]] } };
    const diff = diffWorkflows(workflow(), after);

    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, renamed: 1 });
    expect(diff.nodes[0].name).toBe('Transformation');
    expect(diff.nodes[0].renamedFrom).toBe('Code');
  });

  it('reste un ajout + une suppression quand les ids diffèrent', () => {
    const after = workflow();
    after.nodes[1] = { ...after.nodes[1], id: 'nouveau', name: 'Transformation' };
    const diff = diffWorkflows(workflow(), after);

    expect(diff.counts).toEqual({ added: 1, removed: 1, modified: 0, renamed: 0 });
  });

  it("ignore l'id n8n d'un nœud (aucune valeur métier)", () => {
    const after = workflow();
    after.nodes[0].id = 'autre-id';
    expect(diffWorkflows(workflow(), after).hasChanges).toBe(false);
  });
});
