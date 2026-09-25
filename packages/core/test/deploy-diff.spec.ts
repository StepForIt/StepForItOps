import { describe, expect, it } from 'vitest';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { deployKey } from '../src/domain/n8n/deploy-key';
import { deployDiff } from '../src/domain/n8n/deploy-diff';

const prod: N8nWorkflow = {
  name: 'Facturation - PROD',
  nodes: [
    {
      id: 'p1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      webhookId: 'hook-prod',
      position: [0, 0],
      parameters: { path: 'facture', httpMethod: 'POST' },
    },
    {
      id: 'p2',
      name: 'Airtable',
      type: 'n8n-nodes-base.airtable',
      position: [200, 0],
      parameters: { base: { __rl: true, value: 'appPROD123', mode: 'list', cachedResultName: 'CRM' } },
      credentials: { airtableTokenApi: { id: 'credPROD', name: 'Airtable PROD' } },
    },
  ],
  connections: { Webhook: { main: [[{ node: 'Airtable', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
};

/** Le même workflow en dev : ne diffère que par ce que la promotion bascule ou préserve. */
const dev: N8nWorkflow = {
  ...prod,
  name: 'Facturation - DEV',
  nodes: [
    {
      ...prod.nodes[0],
      id: 'd1',
      webhookId: 'hook-dev',
      position: [40, 40],
      parameters: { httpMethod: 'POST', path: 'facture-dev' },
    },
    {
      ...prod.nodes[1],
      id: 'd2',
      parameters: { base: { __rl: true, value: 'appDEV1234', mode: 'list', cachedResultName: 'CRM (dev)' } },
      credentials: { airtableTokenApi: { id: 'credDEV', name: 'Airtable DEV' } },
    },
  ],
};

const context = {
  mappings: [
    { dev: { baseId: 'appDEV1234' }, prod: { baseId: 'appPROD123' } },
    { dev: { credentialId: 'credDEV' }, prod: { credentialId: 'credPROD' } },
  ],
};

function withNode(workflow: N8nWorkflow, index: number, patch: Partial<N8nNode>): N8nWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node, i) => (i === index ? { ...node, ...patch } : node)),
  };
}

const variants: Record<string, N8nWorkflow> = {
  identique: dev,
  'paramètre modifié': withNode(dev, 0, { parameters: { httpMethod: 'GET', path: 'facture-dev' } }),
  'réglage du nœud (onError)': withNode(dev, 1, { onError: 'continueRegularOutput' }),
  'réglage du nœud (retryOnFail)': withNode(dev, 1, { retryOnFail: true, maxTries: 3 }),
  'nœud désactivé': withNode(dev, 1, { disabled: true }),
  'nœud ajouté': {
    ...dev,
    nodes: [...dev.nodes, { name: 'Slack', type: 'n8n-nodes-base.slack', parameters: {} }],
  },
  'câblage retiré': { ...dev, connections: {} },
  'réglage du workflow': { ...dev, settings: { executionOrder: 'v0' } },
  'ressource non mappée': withNode(dev, 1, {
    parameters: { base: { __rl: true, value: 'appAUTRE999', mode: 'list' } },
  }),
};

describe('deployDiff', () => {
  it.each(Object.entries(variants))(
    'dit un écart exactement quand l’empreinte diffère — %s',
    (_label, candidate) => {
      const keysDiffer = deployKey(candidate, context) !== deployKey(prod, context);
      const diff = deployDiff({ workflow: prod, context }, { workflow: candidate, context });
      expect(diff.hasChanges).toBe(keysDiffer);
    },
  );

  it('ne montre rien de ce que la promotion neutralise', () => {
    const diff = deployDiff({ workflow: prod, context }, { workflow: dev, context });
    expect(diff.hasChanges).toBe(false);
    expect(diff.nameChange).toBeNull();
  });

  it('montre le réglage modifié, avec sa phrase', () => {
    const diff = deployDiff(
      { workflow: prod, context },
      { workflow: withNode(dev, 0, { parameters: { httpMethod: 'GET', path: 'facture-dev' } }), context },
    );
    expect(diff.nodes).toHaveLength(1);
    expect(diff.nodes[0]).toMatchObject({ name: 'Webhook', change: 'modified', fields: ['parameters'] });
    expect(diff.nodes[0].explanations.length).toBeGreaterThan(0);
  });

  it('montre un réglage de nœud hors paramètres (onError)', () => {
    const diff = deployDiff(
      { workflow: prod, context },
      { workflow: withNode(dev, 1, { onError: 'continueRegularOutput' }), context },
    );
    expect(diff.nodes[0]).toMatchObject({ name: 'Airtable', fields: ['onError'] });
  });

  it('ne prend pas un ordre de clés différent pour un écart', () => {
    const reordered = withNode(dev, 0, { parameters: { path: 'facture-dev', httpMethod: 'POST' } });
    expect(deployDiff({ workflow: prod, context }, { workflow: reordered, context }).hasChanges).toBe(false);
  });
});
