import { describe, expect, it } from 'vitest';
import { pairCallees, planCalleePublication } from '../src/domain/n8n/callee-publication';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const call = (target: string, extra: Partial<N8nNode> = {}): N8nNode => ({
  id: `call-${target}`,
  name: `Call ${target}`,
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  position: [0, 0],
  parameters: { workflowId: { __rl: true, mode: 'list', value: target } },
  ...extra,
});

const subTrigger: N8nNode = {
  id: 't',
  name: 'When Executed by Another Workflow',
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  position: [0, 0],
  parameters: {},
};

const workflow = (
  id: string,
  nodes: N8nNode[],
  { published = false, archived = false }: { published?: boolean; archived?: boolean } = {},
): N8nWorkflow =>
  ({
    id,
    name: `WF ${id}`,
    nodes,
    connections: {},
    activeVersionId: published ? `v-${id}` : null,
    ...(archived ? { isArchived: true } : {}),
  }) as N8nWorkflow;

const lookup = (...workflows: N8nWorkflow[]) => {
  const byId = new Map(workflows.map((w) => [String(w.id), w]));
  return (id: string) => byId.get(id);
};

describe('planCalleePublication', () => {
  it('publie un appelé en brouillon dont le seul déclencheur est l’appel', () => {
    const root = workflow('root', [call('a')]);
    const plan = planCalleePublication(root, lookup(workflow('a', [subTrigger])));
    expect(plan).toEqual({ publish: [{ id: 'a', name: 'WF a' }], manual: [] });
  });

  it('ne touche pas un appelé déjà publié', () => {
    const root = workflow('root', [call('a')]);
    expect(planCalleePublication(root, lookup(workflow('a', [subTrigger], { published: true })))).toEqual({
      publish: [],
      manual: [],
    });
  });

  it('publie les plus profonds d’abord : n8n valide les appelés de chaque workflow publié', () => {
    const root = workflow('root', [call('a')]);
    const plan = planCalleePublication(
      root,
      lookup(workflow('a', [subTrigger, call('b')]), workflow('b', [subTrigger])),
    );
    expect(plan.publish.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('laisse à l’humain un appelé qui démarrerait seul une fois publié', () => {
    const schedule: N8nNode = {
      id: 's',
      name: 'Schedule',
      type: 'n8n-nodes-base.scheduleTrigger',
      position: [0, 0],
      parameters: {},
    };
    const plan = planCalleePublication(
      workflow('root', [call('a')]),
      lookup(workflow('a', [subTrigger, schedule])),
    );
    expect(plan.publish).toEqual([]);
    expect(plan.manual).toEqual([{ id: 'a', name: 'WF a', reason: expect.stringContaining('schedule') }]);
  });

  it('ne publie pas un appelé dont un appelé reste à publier à la main', () => {
    const webhook: N8nNode = {
      id: 'w',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      position: [0, 0],
      parameters: { path: 'x' },
    };
    const plan = planCalleePublication(
      workflow('root', [call('a')]),
      lookup(workflow('a', [subTrigger, call('b')]), workflow('b', [webhook])),
    );
    expect(plan.publish).toEqual([]);
    expect(plan.manual.map((m) => [m.id, m.reason])).toEqual([
      ['b', expect.stringContaining('webhook')],
      ['a', expect.stringContaining('WF b')],
    ]);
  });

  it('laisse à l’humain un appelé archivé : n8n ne le publiera pas', () => {
    const plan = planCalleePublication(
      workflow('root', [call('a')]),
      lookup(workflow('a', [subTrigger], { archived: true })),
    );
    expect(plan.manual).toEqual([{ id: 'a', name: 'WF a', reason: expect.stringContaining('archivé') }]);
  });

  it('ignore ce que n8n ne vérifie pas : appel désactivé, id calculé, appelé inconnu, outil IA', () => {
    const root = workflow('root', [
      call('a', { disabled: true }),
      call('b', { parameters: { workflowId: '={{ $json.id }}' } }),
      call('inconnu'),
      call('c', { type: '@n8n/n8n-nodes-langchain.toolWorkflow' }),
    ]);
    const plan = planCalleePublication(
      root,
      lookup(workflow('a', [subTrigger]), workflow('b', [subTrigger]), workflow('c', [subTrigger])),
    );
    expect(plan).toEqual({ publish: [], manual: [] });
  });

  it('ne visite un appelé qu’une fois, même appelé deux fois ou en boucle', () => {
    const root = workflow('root', [call('a'), call('a', { id: 'bis', name: 'Call a bis' })]);
    const plan = planCalleePublication(root, lookup(workflow('a', [subTrigger, call('root')]), root));
    expect(plan.publish.map((p) => p.id)).toEqual(['a']);
  });

  it('ne dit rien sur un n8n sans publication par versions', () => {
    const direct = { id: 'a', name: 'WF a', nodes: [subTrigger], connections: {} } as N8nWorkflow;
    expect(planCalleePublication(workflow('root', [call('a')]), lookup(direct))).toEqual({
      publish: [],
      manual: [],
    });
  });
});

describe('pairCallees', () => {
  it('apparie les appelés par le nœud qui appelle', () => {
    const source = workflow('s', [call('dev-a'), call('dev-b')]);
    const target = workflow('t', [call('prod-a', { name: 'Call dev-a' })]);
    expect(pairCallees(source, target)).toEqual([
      { source: 'dev-a', target: 'prod-a' },
      { source: 'dev-b', target: undefined },
    ]);
  });
});
