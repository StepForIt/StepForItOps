import { describe, expect, it } from 'vitest';
import { ExampleWorkflow, N8nWorkflow, findNodeExamples, workflowSkeleton } from '../src';

function workflow(
  id: string,
  name: string,
  nodes: N8nWorkflow['nodes'],
  options: { instance?: string; updatedAt?: string; connections?: N8nWorkflow['connections'] } = {},
): ExampleWorkflow {
  return {
    id,
    name,
    instance: options.instance ?? 'prod',
    updatedAt: new Date(options.updatedAt ?? '2026-01-01'),
    raw: { name, nodes, connections: options.connections ?? {} },
  };
}

const http = (name: string, url: string) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4,
  parameters: { url, method: 'GET' },
});

describe('findNodeExamples', () => {
  it('rend les nœuds du type demandé, du workflow le plus récent au plus ancien', () => {
    const corpus = [
      workflow('a', 'Ancien', [http('Appel', 'https://a.test')], { updatedAt: '2026-01-01' }),
      workflow('b', 'Récent', [http('Appel', 'https://b.test')], { updatedAt: '2026-06-01' }),
    ];
    const result = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' });
    expect(result.total).toBe(2);
    expect(result.workflows).toBe(2);
    expect(result.examples.map((e) => e.workflow)).toEqual(['Récent', 'Ancien']);
  });

  it('écarte le workflow de la conversation, les sticky notes et les nœuds désactivés', () => {
    const corpus = [
      workflow('courant', 'Le mien', [http('Appel', 'https://x.test')]),
      workflow('autre', 'Ailleurs', [
        { name: 'Note', type: 'n8n-nodes-base.stickyNote', parameters: { content: 'http' } },
        { ...http('Mort', 'https://y.test'), disabled: true },
      ]),
    ];
    const result = findNodeExamples(corpus, {
      nodeType: 'n8n-nodes-base.httpRequest',
      excludeWorkflowId: 'courant',
    });
    expect(result.examples).toHaveLength(0);
  });

  it('ne compte qu’une fois deux nœuds identiques, et dit combien il y en a', () => {
    const corpus = [
      workflow('a', 'Un', [http('Appel', 'https://same.test')]),
      workflow('b', 'Deux', [http('Copie', 'https://same.test')]),
    ];
    const result = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' });
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0].duplicates).toBe(1);
    expect(result.total).toBe(2);
  });

  it('ne prend pas plus de deux exemples dans un même workflow', () => {
    const corpus = [
      workflow('a', 'Tout en un', [
        http('A', 'https://1.test'),
        http('B', 'https://2.test'),
        http('C', 'https://3.test'),
      ]),
    ];
    const result = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' });
    expect(result.examples).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('masque les secrets des paramètres rendus', () => {
    const corpus = [
      workflow('a', 'Un', [
        {
          name: 'Appel',
          type: 'n8n-nodes-base.httpRequest',
          parameters: {
            url: 'https://api.test',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Authorization', value: 'Bearer sk-ant-abcdefghijklmnopqrstuvwx' }],
            },
          },
        },
      ]),
    ];
    const [example] = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' }).examples;
    const rendered = JSON.stringify(example.parameters);
    expect(rendered).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
    expect(rendered).toContain('secret masqué');
    expect(rendered).toContain('Authorization');
  });

  it('situe le nœud dans son flux', () => {
    const corpus = [
      workflow('a', 'Un', [{ name: 'Start', type: 'n8n-nodes-base.noOp' }, http('Appel', 'https://x.test')], {
        connections: { Start: { main: [[{ node: 'Appel', type: 'main', index: 0 }]] } },
      }),
    ];
    const [example] = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' }).examples;
    expect(example.upstream).toEqual(['Start']);
    expect(example.downstream).toEqual([]);
  });

  it('exige tous les mots d’une recherche libre', () => {
    const corpus = [workflow('a', 'Relance client', [http('Appel CRM', 'https://crm.test')])];
    expect(findNodeExamples(corpus, { query: 'relance crm' }).examples).toHaveLength(1);
    expect(findNodeExamples(corpus, { query: 'relance facture' }).examples).toHaveLength(0);
  });

  it('ne rend rien sans critère', () => {
    const corpus = [workflow('a', 'Un', [http('Appel', 'https://x.test')])];
    expect(findNodeExamples(corpus, {}).total).toBe(0);
  });

  it('garde le prompt d’un nœud IA, là où il retire les grosses clés des autres', () => {
    const prompt = 'Tu es copywriter. '.repeat(500); // ~9 000 caractères, au-delà du budget
    const corpus = [
      workflow('a', 'Fiches produit', [
        {
          name: 'Message a model',
          type: '@n8n/n8n-nodes-langchain.openAi',
          typeVersion: 2.1,
          parameters: {
            modelId: 'gpt-5.4-mini',
            responses: { values: [{ role: 'system', content: prompt }] },
          },
        },
      ]),
    ];
    const { examples } = findNodeExamples(corpus, { nodeType: '@n8n/n8n-nodes-langchain.openAi' });
    const rendered = JSON.stringify(examples[0].parameters);
    expect(examples[0].parametersOmitted).toBeUndefined();
    expect(rendered).toContain('Tu es copywriter.');
    expect(rendered).toContain('truncated'); // tronqué, jamais retiré
    expect(examples[0].parameters.modelId).toBe('gpt-5.4-mini');
  });

  it('retire encore la plus grosse clé d’un nœud ordinaire', () => {
    const corpus = [
      workflow('a', 'Mailing', [
        {
          name: 'Envoi',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4,
          parameters: { url: 'https://a.test', body: 'x'.repeat(3_000) },
        },
      ]),
    ];
    const { examples } = findNodeExamples(corpus, { nodeType: 'n8n-nodes-base.httpRequest' });
    expect(examples[0].parametersOmitted).toEqual(['body']);
    expect(examples[0].parameters.url).toBe('https://a.test');
  });
});

describe('workflowSkeleton', () => {
  it('rend les nœuds et le câblage, sans les paramètres', () => {
    const source = workflow(
      'a',
      'Facturation',
      [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'secret-path' } },
        { name: 'Start', type: 'n8n-nodes-base.noOp' },
        { name: 'Note', type: 'n8n-nodes-base.stickyNote' },
      ],
      { connections: { Webhook: { main: [[{ node: 'Start', type: 'main', index: 0 }]] } } },
    );
    const skeleton = workflowSkeleton(source);
    expect(skeleton.nodes.map((n) => n.name)).toEqual(['Webhook', 'Start']);
    expect(skeleton.nodes[0].trigger).toBe(true);
    expect(skeleton.edges).toEqual(['Webhook → Start']);
    expect(JSON.stringify(skeleton)).not.toContain('secret-path');
  });
});
