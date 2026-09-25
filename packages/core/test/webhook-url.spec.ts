import { describe, expect, it } from 'vitest';
import { extractUrlHost, extractWebhookPath, workflowWebhookPaths } from '../src/domain/n8n/webhook-url';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

describe('extractWebhookPath', () => {
  it('extrait le chemin après /webhook/', () => {
    expect(extractWebhookPath('https://n8n.exemple.fr/webhook/health-check')).toBe('health-check');
  });

  it('gère /webhook-test/, les query strings et les slashes superflus', () => {
    expect(extractWebhookPath('https://n8n.exemple.fr/webhook-test/abc/def/?x=1')).toBe('abc/def');
  });

  it('retourne null sans segment webhook', () => {
    expect(extractWebhookPath('https://exemple.fr/api/status')).toBeNull();
  });
});

describe('extractUrlHost', () => {
  it('retourne le host, ou null si URL invalide', () => {
    expect(extractUrlHost('https://n8n.exemple.fr:5678/webhook/x')).toBe('n8n.exemple.fr:5678');
    expect(extractUrlHost('pas une url')).toBeNull();
  });
});

describe('workflowWebhookPaths', () => {
  const workflow = (nodes: N8nWorkflow['nodes']): N8nWorkflow => ({
    name: 'wf',
    nodes,
    connections: {},
  });

  it('liste les paths des nœuds webhook, fallback sur webhookId', () => {
    const wf = workflow([
      { name: 'Hook', type: 'n8n-nodes-base.webhook', parameters: { path: '/health/' } },
      { name: 'Form', type: 'n8n-nodes-base.formTrigger', webhookId: 'uuid-1', parameters: { path: '' } },
      { name: 'Set', type: 'n8n-nodes-base.set' },
    ]);
    expect(workflowWebhookPaths(wf)).toEqual(['health', 'uuid-1']);
  });

  it('ignore les nœuds désactivés', () => {
    const wf = workflow([
      { name: 'Hook', type: 'n8n-nodes-base.webhook', disabled: true, parameters: { path: 'x' } },
    ]);
    expect(workflowWebhookPaths(wf)).toEqual([]);
  });
});
