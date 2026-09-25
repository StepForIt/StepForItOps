import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { workflowToMermaid } from '../src/domain/n8n/mermaid';

const wf: N8nWorkflow = {
  name: 'test',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
    { name: 'Set', type: 'n8n-nodes-base.set' },
    { name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote' },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
    // Connexion résiduelle : les deux extrémités ont disparu de `nodes`.
    Ghost: { main: [[{ node: 'Ghost target', type: 'main', index: 0 }]] },
  },
};

describe('workflowToMermaid', () => {
  it('dessine les nœuds réels et leurs arêtes', () => {
    const mermaid = workflowToMermaid(wf);
    expect(mermaid).toContain('Webhook');
    expect(mermaid.split('\n').filter((line) => line.includes('-->'))).toHaveLength(1);
  });

  it('entoure les nœuds porteurs de findings, sans toucher aux autres', () => {
    const mermaid = workflowToMermaid(wf, {
      flagged: new Map([
        ['Set', 'error'],
        ['Sticky Note', 'warning'], // non dessiné : ne doit produire aucune classe
      ]),
    });
    const setId = mermaid.match(/(n\d+)\["Set/)![1];
    expect(mermaid).toContain(`class ${setId} findingError;`);
    expect(mermaid.split('\n').filter((line) => line.trim().startsWith('class '))).toHaveLength(1);
  });

  it('colorie les portes d’entrée et annonce la cible des appels', () => {
    const mermaid = workflowToMermaid({
      name: 'test',
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        {
          name: 'Call',
          type: 'n8n-nodes-base.executeWorkflow',
          parameters: {
            workflowId: { __rl: true, mode: 'list', value: 'c1', cachedResultName: 'Enrichissement' },
          },
        },
        {
          name: 'Ping',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://n8n.example.com/webhook/facture' },
        },
      ],
      connections: {},
    } as unknown as N8nWorkflow);

    expect(mermaid).toContain(':::trigger');
    expect(mermaid).toContain('→ Enrichissement');
    expect(mermaid).toContain('→ https://n8n.example.com/webhook/facture');
    expect(mermaid.split('\n').filter((l) => l.includes(':::outgoing'))).toHaveLength(2);
  });

  it('ignore les connexions vers un nœud absent', () => {
    const mermaid = workflowToMermaid(wf);
    expect(mermaid).not.toContain('Ghost');
    expect(mermaid).not.toContain('introuvable');
  });
});
