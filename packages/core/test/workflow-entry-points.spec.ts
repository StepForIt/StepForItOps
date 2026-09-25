import { describe, expect, it } from 'vitest';
import { workflowEntryPoints } from '../src/domain/n8n/workflow-entry-points';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(nodes: Array<Record<string, unknown>>): N8nWorkflow {
  return { name: 'WF', nodes, connections: {} } as unknown as N8nWorkflow;
}

describe('workflow-entry-points', () => {
  it('donne une porte par trigger : webhook et formulaire ne se départagent pas', () => {
    const entries = workflowEntryPoints(
      workflowWith([
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: '/facture/' } },
        { name: 'Form', type: 'n8n-nodes-base.formTrigger', webhookId: 'abc-123' },
      ]),
    );

    expect(entries).toEqual([
      { kind: 'webhook', nodeName: 'Webhook', segment: 'webhook', path: 'facture' },
      { kind: 'form', nodeName: 'Form', segment: 'form', path: 'abc-123' },
    ]);
  });

  it('lit le path d’un formulaire 2.2+ dans ses options', () => {
    const entries = workflowEntryPoints(
      workflowWith([
        {
          name: 'Form',
          type: 'n8n-nodes-base.formTrigger',
          typeVersion: 2.3,
          webhookId: 'abc-123',
          parameters: { options: { path: 'contact' } },
        },
      ]),
    );
    expect(entries[0].path).toBe('contact');
  });

  it('décrit les portes sans URL', () => {
    const entries = workflowEntryPoints(
      workflowWith([
        { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger' },
        { name: 'Telegram', type: 'n8n-nodes-base.telegramTrigger' },
        { name: 'Erreur', type: 'n8n-nodes-base.errorTrigger' },
        { name: 'Bouton', type: 'n8n-nodes-base.manualTrigger' },
      ]),
    );

    expect(entries.map((e) => e.label)).toEqual([
      'planifié',
      'Telegram',
      "erreur d'un workflow",
      'lancé à la main',
    ]);
  });

  it('ignore l’appel d’un parent (déjà une flèche) et les triggers désactivés', () => {
    const entries = workflowEntryPoints(
      workflowWith([
        { name: 'Appelé', type: 'n8n-nodes-base.executeWorkflowTrigger' },
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'x' }, disabled: true },
        { name: 'Set', type: 'n8n-nodes-base.set' },
      ]),
    );

    expect(entries).toEqual([]);
  });
});
