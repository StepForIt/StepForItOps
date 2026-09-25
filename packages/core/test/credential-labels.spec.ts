import { describe, expect, it } from 'vitest';
import { relabelCredentials } from '../src/domain/n8n/credential-labels';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(credentials: Record<string, { id?: string; name?: string }>): N8nWorkflow {
  return {
    name: 'WF',
    nodes: [{ name: 'Airtable', type: 'n8n-nodes-base.airtable', parameters: {}, credentials }],
    connections: {},
  } as unknown as N8nWorkflow;
}

describe('credential-labels', () => {
  it('pose le vrai nom quand le mapping le connaît', () => {
    const { workflow, relabeled } = relabelCredentials(
      workflowWith({ airtableTokenApi: { id: 'cred-prod', name: 'Airtable Dev' } }),
      new Map([['cred-prod', 'Airtable Prod']]),
      'prod',
      new Set(['cred-prod']),
    );
    expect(relabeled).toEqual([{ nodeName: 'Airtable', from: 'Airtable Dev', to: 'Airtable Prod' }]);
    expect(workflow.nodes[0].credentials?.airtableTokenApi).toEqual({
      id: 'cred-prod',
      name: 'Airtable Prod',
    });
  });

  it('estampille l’env quand le nom est inconnu', () => {
    const { workflow } = relabelCredentials(
      workflowWith({ airtableTokenApi: { id: 'cred-prod', name: 'Airtable (dev)' } }),
      new Map(),
      'prod',
      new Set(['cred-prod']),
    );
    expect(workflow.nodes[0].credentials?.airtableTokenApi?.name).toBe('Airtable (prod)');
  });

  it('laisse tranquille une credential que la bascule n’a pas touchée', () => {
    const { workflow, relabeled } = relabelCredentials(
      workflowWith({ slackApi: { id: 'cred-slack', name: 'Slack' } }),
      new Map(),
      'prod',
      new Set(['cred-prod']),
    );
    expect(relabeled).toEqual([]);
    expect(workflow.nodes[0].credentials?.slackApi?.name).toBe('Slack');
  });
});
