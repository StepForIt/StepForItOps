import { describe, expect, it } from 'vitest';
import { diffWorkflows } from '../src/domain/n8n/workflow-diff';
import { pairRenamedNodes } from '../src/domain/n8n/node-pairing';
import { deployDiff } from '../src/domain/n8n/deploy-diff';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

/** Le cas d'étude : un If et la boucle qu'il lit, renommés tous les deux, ids de nœuds perdus. */
function mockupCheck(names: { loop: string; check: string }, extra: Partial<N8nNode> = {}): N8nWorkflow {
  return {
    name: 'Prospects',
    nodes: [
      {
        name: names.loop,
        type: 'n8n-nodes-base.splitInBatches',
        typeVersion: 3,
        position: [0, 0],
        parameters: { options: {} },
      },
      {
        name: names.check,
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [200, 0],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              {
                id: '184ff7ba-342c-471d-8e0d-3a0362a05e14',
                leftValue: `={{ $('${names.loop}').item.json.Mockup[0].thumbnails.full.url }}`,
                rightValue: '',
                operator: { type: 'string', operation: 'notExists', singleValue: true },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        ...extra,
      },
    ],
    connections: { [names.loop]: { main: [[], [{ node: names.check, type: 'main', index: 0 }]] } },
  };
}

const before = mockupCheck({ loop: 'StartLoop', check: 'If do not have mockup' });
const after = mockupCheck(
  { loop: 'Start Prospect Loop', check: 'Check Mockup Existence' },
  {
    notes: 'Vérifie si le prospect dispose d’une maquette (mockup) valide avant de poursuivre le traitement.',
    notesInFlow: false,
  },
);

describe('pairRenamedNodes', () => {
  it('reconnaît le cas d’étude : un renommage chacun, aucun ajout ni suppression', () => {
    const diff = diffWorkflows(before, after);

    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, renamed: 2 });
    const check = diff.nodes.find((node) => node.name === 'Check Mockup Existence');
    expect(check).toMatchObject({ change: 'renamed', renamedFrom: 'If do not have mockup' });
    // `leftValue` ne fait que suivre le renommage de StartLoop : ni champ, ni ligne.
    expect(check?.fields).toEqual(['notes', 'notesInFlow']);
    expect(check?.lines.filter((line) => line.type !== 'ctx').some((l) => l.text.includes('leftValue'))).toBe(
      false,
    );
    expect(diff.connections.changed).toBe(false);
  });

  it('dit sur quoi chaque paire repose, la boucle débloquant le If', () => {
    const renames = pairRenamedNodes(before.nodes, after.nodes);
    expect(renames).toEqual(
      expect.arrayContaining([
        { oldName: 'If do not have mockup', newName: 'Check Mockup Existence', evidence: 'parameter-ids' },
        { oldName: 'StartLoop', newName: 'Start Prospect Loop', evidence: 'fingerprint' },
      ]),
    );
  });

  it('suit un renommage en chaîne par empreinte quand les paramètres n’ont aucun uuid', () => {
    const set = (name: string, ref: string): N8nNode => ({
      name,
      type: 'n8n-nodes-base.set',
      parameters: { value: `={{ $('${ref}').item.json.x }}` },
    });
    const source = (name: string): N8nNode => ({ name, type: 'n8n-nodes-base.noOp', parameters: {} });
    const renames = pairRenamedNodes([source('A'), set('B', 'A')], [source('A2'), set('B2', 'A2')]);
    expect(renames.map((r) => `${r.oldName}→${r.newName}`).sort()).toEqual(['A→A2', 'B→B2']);
  });

  it('laisse deux jumeaux en ajout + suppression plutôt que d’en inventer l’ordre', () => {
    const twin = (name: string): N8nNode => ({ name, type: 'n8n-nodes-base.noOp', parameters: {} });
    expect(pairRenamedNodes([twin('A'), twin('B')], [twin('C'), twin('D')])).toEqual([]);
  });

  it('n’apparie pas deux nœuds de types différents qui partagent un uuid', () => {
    const id = '184ff7ba-342c-471d-8e0d-3a0362a05e14';
    const renames = pairRenamedNodes(
      [{ name: 'A', type: 'n8n-nodes-base.if', parameters: { c: [{ id, v: 1 }] } }],
      [{ name: 'B', type: 'n8n-nodes-base.filter', parameters: { c: [{ id, v: 2 }] } }],
    );
    expect(renames).toEqual([]);
  });
});

describe('deployDiff', () => {
  it('reconnaît un renommage entre deux envs par l’id du nœud', () => {
    const prod: N8nWorkflow = {
      name: 'X - PROD',
      nodes: [{ id: 'n1', name: 'Old', type: 'n8n-nodes-base.code', parameters: { jsCode: 'a' } }],
      connections: {},
    };
    const dev: N8nWorkflow = {
      name: 'X - DEV',
      nodes: [{ id: 'n1', name: 'New', type: 'n8n-nodes-base.code', parameters: { jsCode: 'b' } }],
      connections: {},
    };
    const diff = deployDiff({ workflow: prod }, { workflow: dev });
    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, renamed: 1 });
    expect(diff.nodes[0].fields).toEqual(['parameters']);
  });
});
