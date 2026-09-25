import { describe, expect, it } from 'vitest';
import { buildAutoWorkflowLinks, extractWorkflowCalls } from '../src/domain/n8n/workflow-links';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(nodes: Array<Record<string, unknown>>): N8nWorkflow {
  return { name: 'WF', nodes, connections: {} } as unknown as N8nWorkflow;
}

const executeNode = {
  name: 'Execute Workflow',
  type: 'n8n-nodes-base.executeWorkflow',
  parameters: {
    workflowId: { __rl: true, mode: 'list', value: 'child-1', cachedResultName: 'Enrichissement' },
  },
};

describe('workflow-links', () => {
  it('détecte un sous-workflow appelé par Execute Workflow', () => {
    expect(extractWorkflowCalls(workflowWith([executeNode]))).toEqual([
      {
        nodeName: 'Execute Workflow',
        kind: 'execute',
        targetN8nId: 'child-1',
        targetLabel: 'Enrichissement',
      },
    ]);
  });

  it('détecte un sous-workflow branché comme outil sur un agent IA', () => {
    const calls = extractWorkflowCalls(
      workflowWith([
        {
          name: 'Outil facture',
          type: '@n8n/n8n-nodes-langchain.toolWorkflow',
          parameters: { workflowId: { __rl: true, mode: 'list', value: 'child-2' } },
        },
      ]),
    );
    expect(calls).toEqual([
      { nodeName: 'Outil facture', kind: 'tool', targetN8nId: 'child-2', targetLabel: undefined },
    ]);
  });

  it('détecte un appel HTTP vers le webhook d’un autre workflow', () => {
    const calls = extractWorkflowCalls(
      workflowWith([
        {
          name: 'HTTP Request',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://n8n.example.com/webhook/facture-recue' },
        },
      ]),
    );
    expect(calls).toEqual([
      {
        nodeName: 'HTTP Request',
        kind: 'webhook',
        targetWebhookPath: 'facture-recue',
        targetUrl: 'https://n8n.example.com/webhook/facture-recue',
      },
    ]);
  });

  it('ignore les nœuds désactivés', () => {
    expect(extractWorkflowCalls(workflowWith([{ ...executeNode, disabled: true }]))).toEqual([]);
  });

  it('résout les cibles par id n8n et par chemin de webhook', () => {
    const links = buildAutoWorkflowLinks([
      {
        id: 'a',
        externalId: 'parent',
        name: 'Parent',
        raw: workflowWith([
          executeNode,
          {
            name: 'Ping facture',
            type: 'n8n-nodes-base.httpRequest',
            parameters: { url: 'https://n8n.example.com/webhook/facture-recue' },
          },
        ]),
      },
      { id: 'b', externalId: 'child-1', name: 'Enrichissement', raw: workflowWith([]) },
      {
        id: 'c',
        externalId: 'facture',
        name: 'Facture',
        raw: workflowWith([
          { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'facture-recue' } },
        ]),
      },
    ]);

    expect(links).toEqual([
      { fromWorkflowId: 'a', toWorkflowId: 'b', kind: 'execute', nodeNames: ['Execute Workflow'] },
      { fromWorkflowId: 'a', toWorkflowId: 'c', kind: 'webhook', nodeNames: ['Ping facture'] },
    ]);
  });

  it('affiche l’URL entière quand l’appel vise une autre installation n8n', () => {
    const caller = {
      id: 'a',
      externalId: 'parent',
      name: 'Parent',
      raw: workflowWith([
        {
          name: 'Ping distant',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://autre.app.n8n.cloud/webhook/facture-recue' },
        },
      ]),
    };
    const local = {
      id: 'c',
      externalId: 'facture',
      name: 'Facture',
      raw: workflowWith([
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'facture-recue' } },
      ]),
    };

    // Hôte inconnu : pas de rapprochement avec le webhook local qui porte le même chemin.
    expect(buildAutoWorkflowLinks([caller, local], ['n8n.chez-moi.fr'])[0]).toMatchObject({
      unresolvedKey: 'webhook:https://autre.app.n8n.cloud/webhook/facture-recue',
      unresolvedLabel: 'https://autre.app.n8n.cloud/webhook/facture-recue',
    });

    // Même hôte : la cible locale est retrouvée.
    expect(buildAutoWorkflowLinks([caller, local], ['autre.app.n8n.cloud'])[0]).toMatchObject({
      toWorkflowId: 'c',
    });

    // Sans hôtes connus (appelant historique), on garde le rapprochement par chemin.
    expect(buildAutoWorkflowLinks([caller, local])[0]).toMatchObject({ toWorkflowId: 'c' });
  });

  it('garde une cible non résolue quand le workflow appelé n’est pas synchronisé', () => {
    const links = buildAutoWorkflowLinks([
      { id: 'a', externalId: 'parent', name: 'Parent', raw: workflowWith([executeNode]) },
    ]);
    expect(links).toEqual([
      {
        fromWorkflowId: 'a',
        kind: 'execute',
        unresolvedKey: 'n8n:child-1',
        unresolvedLabel: 'Enrichissement',
        nodeNames: ['Execute Workflow'],
      },
    ]);
  });

  it('garde l’auto-appel d’un workflow (récursion à voir sur le schéma)', () => {
    const links = buildAutoWorkflowLinks([
      {
        id: 'a',
        externalId: 'self',
        name: 'Normalize phone',
        raw: workflowWith([
          {
            name: "Call 'Normalize phone'",
            type: 'n8n-nodes-base.executeWorkflow',
            parameters: { workflowId: { __rl: true, mode: 'list', value: 'self' } },
          },
        ]),
      },
    ]);
    expect(links).toEqual([
      { fromWorkflowId: 'a', toWorkflowId: 'a', kind: 'execute', nodeNames: ["Call 'Normalize phone'"] },
    ]);
  });

  it('signale une cible dont l’id est construit par expression', () => {
    const links = buildAutoWorkflowLinks([
      {
        id: 'a',
        externalId: 'parent',
        name: 'Parent',
        raw: workflowWith([
          {
            name: 'Execute Workflow',
            type: 'n8n-nodes-base.executeWorkflow',
            parameters: { workflowId: '={{ $json.target }}' },
          },
        ]),
      },
    ]);
    expect(links[0]).toMatchObject({
      unresolvedKey: 'n8n:={{ $json.target }}',
      unresolvedLabel: 'workflow choisi dynamiquement',
    });
  });

  it('signale un appel qui ne part que d’un bout de workflow déclenché à la main', () => {
    const raw = {
      name: 'Create env',
      nodes: [
        { name: 'Bouton', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
        {
          name: 'Trigger webhook',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://n8n.example.com/webhook/create-env' },
        },
        { name: 'Note', type: 'n8n-nodes-base.stickyNote', parameters: {} },
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'create-env' } },
        { name: 'Suite', type: 'n8n-nodes-base.set', parameters: {} },
      ],
      connections: {
        Bouton: { main: [[{ node: 'Trigger webhook', type: 'main', index: 0 }]] },
        Webhook: { main: [[{ node: 'Suite', type: 'main', index: 0 }]] },
      },
    } as unknown as N8nWorkflow;

    const links = buildAutoWorkflowLinks([{ id: 'a', externalId: 'self', name: 'Create env', raw }]);
    expect(links).toEqual([
      {
        fromWorkflowId: 'a',
        toWorkflowId: 'a',
        kind: 'webhook',
        nodeNames: ['Trigger webhook'],
        context: { kind: 'manual', nodeCount: 2 },
      },
    ]);
  });

  it('ne signale rien quand le bout de workflow a un vrai déclencheur', () => {
    const raw = {
      name: 'Planifié',
      nodes: [
        { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
        {
          name: 'Ping',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://n8n.example.com/webhook/facture-recue' },
        },
      ],
      connections: { Cron: { main: [[{ node: 'Ping', type: 'main', index: 0 }]] } },
    } as unknown as N8nWorkflow;

    expect(
      buildAutoWorkflowLinks([{ id: 'a', externalId: 'p', name: 'Planifié', raw }])[0],
    ).not.toHaveProperty('context');
  });

  it('signale un appel émis depuis une boucle', () => {
    const raw = {
      name: 'Boucle',
      nodes: [
        { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
        { name: 'Loop Over Items', type: 'n8n-nodes-base.splitInBatches', parameters: {} },
        { ...executeNode, name: 'Traiter un lot' },
        { name: 'Fini', type: 'n8n-nodes-base.noOp', parameters: {} },
      ],
      connections: {
        Cron: { main: [[{ node: 'Loop Over Items', type: 'main', index: 0 }]] },
        'Loop Over Items': {
          main: [
            [{ node: 'Fini', type: 'main', index: 0 }],
            [{ node: 'Traiter un lot', type: 'main', index: 0 }],
          ],
        },
        'Traiter un lot': { main: [[{ node: 'Loop Over Items', type: 'main', index: 0 }]] },
      },
    } as unknown as N8nWorkflow;

    const links = buildAutoWorkflowLinks([
      { id: 'a', externalId: 'parent', name: 'Boucle', raw },
      { id: 'b', externalId: 'child-1', name: 'Enrichissement', raw: workflowWith([]) },
    ]);
    // Le tour = Loop Over Items + le nœud qui rappelle la boucle.
    expect(links[0].context).toEqual({ kind: 'loop', nodeCount: 2 });
  });

  it('signale un appel émis depuis une branche de sous-workflow', () => {
    const raw = {
      name: 'Enfant',
      nodes: [
        { name: 'Appelé par un workflow', type: 'n8n-nodes-base.executeWorkflowTrigger', parameters: {} },
        executeNode,
      ],
      connections: {
        'Appelé par un workflow': { main: [[{ node: 'Execute Workflow', type: 'main', index: 0 }]] },
      },
    } as unknown as N8nWorkflow;

    const links = buildAutoWorkflowLinks([
      { id: 'a', externalId: 'parent', name: 'Enfant', raw },
      { id: 'b', externalId: 'child-1', name: 'Enrichissement', raw: workflowWith([]) },
    ]);
    expect(links[0].context).toEqual({ kind: 'sub-workflow', nodeCount: 2 });
  });

  it('regroupe plusieurs nœuds appelant le même workflow', () => {
    const links = buildAutoWorkflowLinks([
      {
        id: 'a',
        externalId: 'parent',
        name: 'Parent',
        raw: workflowWith([executeNode, { ...executeNode, name: 'Execute Workflow1' }]),
      },
      { id: 'b', externalId: 'child-1', name: 'Enrichissement', raw: workflowWith([]) },
    ]);
    expect(links).toEqual([
      {
        fromWorkflowId: 'a',
        toWorkflowId: 'b',
        kind: 'execute',
        nodeNames: ['Execute Workflow', 'Execute Workflow1'],
      },
    ]);
  });
});
