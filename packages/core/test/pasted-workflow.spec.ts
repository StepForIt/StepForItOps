import { describe, expect, it } from 'vitest';
import { findPastedWorkflows, pastedWorkflowBrief } from '../src/domain/n8n/pasted-workflow';

const FRAGMENT = JSON.stringify({
  nodes: [
    {
      name: 'Analyze image',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 2.1,
      parameters: { text: 'Décris {ce} néon' },
    },
    { name: 'Route', type: 'n8n-nodes-base.if', typeVersion: 2 },
  ],
  connections: { 'Analyze image': { main: [[{ node: 'Route', type: 'main', index: 0 }]] } },
  pinData: { 'Analyze image': [[{ json: {} }]] },
});

describe('findPastedWorkflows', () => {
  it('reconnaît un fragment collé et son câblage', () => {
    const [pasted] = findPastedWorkflows(`Pars de ça :\n\`\`\`json\n${FRAGMENT}\n\`\`\`\nen l'adaptant.`);
    expect(pasted.nodes.map((n) => n.name)).toEqual(['Analyze image', 'Route']);
    expect(pasted.nodes[0].typeVersion).toBe(2.1);
    expect(pasted.edges).toEqual(['Analyze image → Route']);
    expect(pasted.hasPinData).toBe(true);
  });

  it('trouve les deux fragments d’un message qui en colle deux', () => {
    expect(findPastedWorkflows(`${FRAGMENT}\n\net aussi\n\n${FRAGMENT}`)).toHaveLength(2);
  });

  it('ne se laisse pas troubler par une accolade dans un prompt', () => {
    const withBraces = JSON.stringify({
      nodes: [
        {
          name: 'IA',
          type: '@n8n/n8n-nodes-langchain.openAi',
          parameters: { text: 'Réponds par { "a": 1 }' },
        },
      ],
      connections: {},
    });
    expect(findPastedWorkflows(withBraces)).toHaveLength(1);
  });

  it('ne rend rien sur un message ordinaire, un JSON tronqué ou un JSON sans nœuds', () => {
    expect(findPastedWorkflows('Corrige la boucle stp')).toEqual([]);
    expect(findPastedWorkflows(FRAGMENT.slice(0, 120))).toEqual([]);
    expect(findPastedWorkflows('{"nodes": "pas un tableau", "autre": "…………………………………"}')).toEqual([]);
  });
});

describe('pastedWorkflowBrief', () => {
  it('nomme chaque nœud collé et rappelle qu’aucun ne se perd', () => {
    const brief = pastedWorkflowBrief(findPastedWorkflows(FRAGMENT));
    expect(brief).toContain('"Route" (n8n-nodes-base.if v2)');
    expect(brief).toContain('Analyze image → Route');
    expect(brief).toContain('pinned data');
  });

  it('ne dit rien quand rien n’a été collé', () => {
    expect(pastedWorkflowBrief([])).toBe('');
  });
});
