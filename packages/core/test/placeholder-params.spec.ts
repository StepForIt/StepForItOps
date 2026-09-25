import { describe, expect, it } from 'vitest';
import { runPlaceholderChecks } from '../src/domain/n8n/placeholder-params';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function wf(nodes: Array<Partial<N8nNode>>): N8nWorkflow {
  return {
    name: 'Test',
    nodes: nodes.map((n, i) => ({ name: n.name ?? `Node ${i}`, type: n.type ?? 'n8n-nodes-base.set', ...n })),
    connections: {},
  };
}

describe('runPlaceholderChecks', () => {
  it('signale une clé restée à YOUR_API_KEY', () => {
    const findings = runPlaceholderChecks(
      wf([
        {
          name: 'Call API',
          type: 'n8n-nodes-base.httpRequest',
          parameters: {
            url: 'https://api.crm.fr/v1/leads',
            sendHeaders: true,
            headerParameters: { parameters: [{ name: 'x-api-key', value: 'YOUR_API_KEY' }] },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].nodeName).toBe('Call API');
    expect(findings[0].code).toBe('param-placeholder');
    expect(findings[0].data.path).toContain('headerParameters');
    expect(findings[0].data.suggestion).toBeTruthy();
  });

  it.each([
    ['<votre-domaine>', '<your-domain>'],
    ['url d’exemple', 'https://api.example.com/v1'],
    ['adresse de test', 'contact@example.com'],
    ['xxx', 'Bearer xxxx'],
    ['changeme', 'changeme'],
    ['à remplacer', 'à remplacer'],
  ])('reconnaît %s', (_label, value) => {
    expect(runPlaceholderChecks(wf([{ parameters: { url: value } }]))).toHaveLength(1);
  });

  it.each([
    ['une vraie url', 'https://crm.stepforit.fr/api/v1/leads'],
    ['une expression n8n', '={{ $json.email }}'],
    ['un vrai token', 'Bearer 8f3c1a9d4b7e2f60'],
    ['un mot qui contient x', 'https://api.exxonmobil.com/data'],
  ])('ne crie pas sur %s', (_label, value) => {
    expect(runPlaceholderChecks(wf([{ parameters: { url: value } }]))).toHaveLength(0);
  });

  it('laisse le contenu des nœuds Code à js-checker', () => {
    const findings = runPlaceholderChecks(
      wf([{ type: 'n8n-nodes-base.code', parameters: { jsCode: 'const key = "YOUR_KEY"; // à remplacer' } }]),
    );
    expect(findings).toHaveLength(0);
  });

  it('ignore un nœud désactivé et les sticky notes', () => {
    const nodes = [
      { name: 'Off', disabled: true, parameters: { url: 'https://example.com' } },
      { name: 'Note', type: 'n8n-nodes-base.stickyNote', parameters: { content: 'mettre <your-url> ici' } },
    ];
    expect(runPlaceholderChecks(wf(nodes))).toHaveLength(0);
  });

  it('ne lit pas un paramètre que la config courante n’exécute pas', () => {
    const findings = runPlaceholderChecks(
      wf([
        {
          type: 'n8n-nodes-base.httpRequest',
          parameters: {
            url: 'https://crm.fr/api',
            sendBody: false,
            bodyParameters: { parameters: [{ name: 'k', value: 'YOUR_TOKEN' }] },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it('plafonne le bruit d’un nœud entièrement à configurer', () => {
    const findings = runPlaceholderChecks(
      wf([
        {
          parameters: {
            a: 'YOUR_A',
            b: 'YOUR_B',
            c: 'YOUR_C',
            d: 'YOUR_D',
            e: 'YOUR_E',
          },
        },
      ]),
    );
    expect(findings).toHaveLength(3);
  });
});
