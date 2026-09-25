import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { deployKey } from '../src/domain/n8n/deploy-key';

const dev: N8nWorkflow = {
  name: 'FORM -> Airtable (1.2.3) - DEV',
  nodes: [
    {
      id: 'a1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      webhookId: 'hook-dev',
      position: [0, 0],
      parameters: { path: 'form-dev', httpMethod: 'POST' },
    },
    {
      id: 'a2',
      name: 'Airtable',
      type: 'n8n-nodes-base.airtable',
      position: [200, 0],
      parameters: {
        base: { __rl: true, value: 'appDEV1234', mode: 'list', cachedResultName: 'CRM (dev)' },
        table: { __rl: true, value: 'tblDEV1234', mode: 'list', cachedResultName: 'Leads' },
      },
      credentials: { airtableTokenApi: { id: 'credDEV', name: 'Airtable DEV' } },
    },
    {
      id: 'a3',
      name: 'Notify',
      type: 'n8n-nodes-base.executeWorkflow',
      position: [400, 0],
      parameters: {
        workflowId: { __rl: true, value: 'wfDEV', mode: 'list', cachedResultName: 'Notify - DEV' },
      },
    },
  ],
  connections: { Webhook: { main: [[{ node: 'Airtable', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1', errorWorkflow: 'errDEV' },
};

/** La même chose, telle qu'une promotion l'a posée en prod. */
const prod: N8nWorkflow = {
  ...dev,
  name: 'FORM -> Airtable (1.2.3) - PROD',
  nodes: [
    {
      ...dev.nodes[0],
      id: 'b1',
      webhookId: 'hook-prod',
      position: [10, 10],
      parameters: { path: 'form', httpMethod: 'POST' },
    },
    {
      ...dev.nodes[1],
      id: 'b2',
      parameters: {
        base: { __rl: true, value: 'appPROD123', mode: 'list', cachedResultName: 'CRM' },
        table: { __rl: true, value: 'tblPROD123', mode: 'list', cachedResultName: 'Leads' },
      },
      credentials: { airtableTokenApi: { id: 'credPROD', name: 'Airtable PROD' } },
    },
    {
      ...dev.nodes[2],
      id: 'b3',
      parameters: {
        workflowId: { __rl: true, value: 'wfPROD', mode: 'list', cachedResultName: 'Notify - PROD' },
      },
    },
  ],
  settings: { executionOrder: 'v1', errorWorkflow: 'errPROD' },
};

const names: Record<string, string> = {
  wfDEV: 'Notify - DEV',
  wfPROD: 'Notify (1.0.1) - PROD',
  errDEV: 'Erreurs - DEV',
  errPROD: 'Erreurs - PROD',
};

const context = {
  mappings: [
    {
      dev: { baseId: 'appDEV1234', tableIds: { leads: 'tblDEV1234' } },
      prod: { baseId: 'appPROD123', tableIds: { leads: 'tblPROD123' } },
    },
    { dev: { credentialId: 'credDEV' }, prod: { credentialId: 'credPROD' } },
  ],
  workflowName: (id: string) => names[id],
};

describe('deployKey', () => {
  it('est un sha1', () => {
    expect(deployKey(dev, context)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('égale dev et prod quand seul diffère ce que la promotion bascule ou préserve', () => {
    expect(deployKey(dev, context)).toBe(deployKey(prod, context));
  });

  it('change dès qu’un vrai paramètre bouge', () => {
    const edited = {
      ...dev,
      nodes: [
        { ...dev.nodes[0], parameters: { path: 'form-dev', httpMethod: 'GET' } },
        ...dev.nodes.slice(1),
      ],
    };
    expect(deployKey(edited, context)).not.toBe(deployKey(prod, context));
  });

  it('change quand un nœud est ajouté ou recâblé', () => {
    const rewired = { ...dev, connections: {} };
    expect(deployKey(rewired, context)).not.toBe(deployKey(prod, context));
  });

  it('voit une ressource non mappée qui diffère : la promotion l’écraserait', () => {
    expect(deployKey(dev, { ...context, mappings: [context.mappings[1]] })).not.toBe(
      deployKey(prod, { ...context, mappings: [context.mappings[1]] }),
    );
  });

  it('voit un sous-workflow qui vise un autre workflow métier', () => {
    const other = {
      ...context,
      workflowName: (id: string) => (id === 'wfPROD' ? 'Autre - PROD' : names[id]),
    };
    expect(deployKey(dev, other)).not.toBe(deployKey(prod, other));
  });

  it('ignore le pinData', () => {
    expect(deployKey({ ...dev, pinData: { Webhook: [{ json: {} }] } } as N8nWorkflow, context)).toBe(
      deployKey(dev, context),
    );
  });

  it('ignore l’écriture du sélecteur : id tapé en expression ou choisi dans la liste', () => {
    const typed = {
      ...dev,
      nodes: [
        dev.nodes[0],
        {
          ...dev.nodes[1],
          parameters: {
            ...dev.nodes[1].parameters,
            base: { __rl: true, value: '=appDEV1234', mode: 'id' },
          },
        },
        dev.nodes[2],
      ],
    };
    expect(deployKey(typed, context)).toBe(deployKey(prod, context));
  });
});

describe('deployKey (Form Trigger)', () => {
  const form = (parameters: Record<string, unknown>, webhookId: string): N8nWorkflow => ({
    name: 'Contact',
    nodes: [
      {
        id: 'f',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        typeVersion: 2.3,
        position: [0, 0],
        parameters: { formTitle: 'Contact', ...parameters },
        webhookId,
      },
    ],
    connections: {},
  });

  it('ignore le path rangé dans les options : la promotion le préserve', () => {
    expect(deployKey(form({ options: { path: 'contact-dev', buttonLabel: 'OK' } }, 'a'))).toBe(
      deployKey(form({ options: { path: 'contact', buttonLabel: 'OK' } }, 'b')),
    );
  });

  it('ignore qu’un env ait un path et l’autre son seul identifiant', () => {
    expect(deployKey(form({ options: { path: 'contact-dev' } }, 'a'))).toBe(
      deployKey(form({ options: {} }, 'b')),
    );
  });
});
