import { describe, expect, it } from 'vitest';
import { runReliabilityChecks } from '../src/domain/n8n/reliability-checks';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function wf(nodes: Array<Partial<N8nNode>>): N8nWorkflow {
  return {
    name: 'Test',
    nodes: nodes.map((n, i) => ({ name: n.name ?? `Node ${i}`, type: n.type ?? 'n8n-nodes-base.set', ...n })),
    connections: {},
  };
}

const codes = (workflow: N8nWorkflow) => runReliabilityChecks(workflow).map((f) => f.code);

describe('http-no-retry', () => {
  it('signale un nœud HTTP sans retry', () => {
    const findings = runReliabilityChecks(wf([{ name: 'Call API', type: 'n8n-nodes-base.httpRequest' }]));
    const finding = findings.find((f) => f.code === 'http-no-retry');
    expect(finding?.nodeName).toBe('Call API');
    expect(finding?.severity).toBe('warning');
    expect(finding?.data?.suggestion).toBeTruthy();
  });

  it('ne dit rien quand le retry est activé, le nœud désactivé, ou non HTTP', () => {
    expect(codes(wf([{ type: 'n8n-nodes-base.httpRequest', retryOnFail: true }]))).not.toContain(
      'http-no-retry',
    );
    expect(codes(wf([{ type: 'n8n-nodes-base.httpRequest', disabled: true }]))).not.toContain(
      'http-no-retry',
    );
    expect(codes(wf([{ type: 'n8n-nodes-base.set' }]))).not.toContain('http-no-retry');
  });
});

describe('error-swallowed', () => {
  it('signale continueRegularOutput et le legacy continueOnFail', () => {
    expect(codes(wf([{ onError: 'continueRegularOutput' }]))).toContain('error-swallowed');
    expect(codes(wf([{ continueOnFail: true }]))).toContain('error-swallowed');
  });

  it('accepte la sortie d’erreur dédiée et l’arrêt sur erreur', () => {
    expect(codes(wf([{ onError: 'continueErrorOutput' }]))).not.toContain('error-swallowed');
    expect(codes(wf([{ onError: 'stopWorkflow' }]))).not.toContain('error-swallowed');
    expect(codes(wf([{}]))).not.toContain('error-swallowed');
  });
});

describe('hardcoded-secret', () => {
  it('reconnaît un token à préfixe connu, où qu’il soit', () => {
    const findings = runReliabilityChecks(
      wf([
        {
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://api.example.com?key=sk-ant-abc123def456ghi789jkl012' },
        },
      ]),
    );
    const finding = findings.find((f) => f.code === 'hardcoded-secret');
    expect(finding?.severity).toBe('error');
    // Le message ne doit jamais recopier le secret entier.
    expect(finding?.message).not.toContain('sk-ant-abc123def456ghi789jkl012');
  });

  it('reconnaît une paire n8n { name, value } au nom sensible', () => {
    const workflow = wf([
      {
        type: 'n8n-nodes-base.httpRequest',
        parameters: {
          // Sans sendHeaders, les headers sont inertes : n8n ne les enverrait pas.
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: 'Authorization', value: 'Bearer abcdef123456789012345' }],
          },
        },
      },
    ]);
    expect(codes(workflow)).toContain('hardcoded-secret');
  });

  it('ignore les expressions (le secret vit dans le credential) et les placeholders', () => {
    const expression = wf([
      {
        parameters: {
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: 'Authorization', value: '=Bearer {{ $credentials.token }}' }],
          },
        },
      },
    ]);
    expect(codes(expression)).not.toContain('hardcoded-secret');

    const placeholder = wf([
      {
        parameters: {
          sendHeaders: true,
          headerParameters: [{ name: 'api_key', value: 'YOUR_API_KEY_HERE' }],
        },
      },
    ]);
    expect(codes(placeholder)).not.toContain('hardcoded-secret');
  });

  it('ne crie pas au loup sur une valeur courte ou un nom anodin', () => {
    const workflow = wf([
      {
        parameters: {
          sendQuery: true,
          queryParameters: { parameters: [{ name: 'token', value: 'abc' }] },
          note: 'le champ password est requis côté API',
        },
      },
    ]);
    expect(codes(workflow)).not.toContain('hardcoded-secret');
  });
});

describe('http-no-timeout', () => {
  it('signale (en info) un nœud HTTP sans timeout', () => {
    const findings = runReliabilityChecks(wf([{ type: 'n8n-nodes-base.httpRequest' }]));
    const finding = findings.find((f) => f.code === 'http-no-timeout');
    expect(finding?.severity).toBe('info');
  });

  it('ne dit rien quand le timeout est posé', () => {
    expect(
      codes(wf([{ type: 'n8n-nodes-base.httpRequest', parameters: { options: { timeout: 10000 } } }])),
    ).not.toContain('http-no-timeout');
  });
});

describe('paramètres inertes', () => {
  it('ne fouille pas les branches que n8n n’exécute plus', () => {
    // Corps désactivé : le bodyParameters résiduel peut contenir un vieux token.
    const workflow = wf([
      {
        type: 'n8n-nodes-base.httpRequest',
        parameters: {
          sendBody: false,
          bodyParameters: {
            parameters: [{ name: 'api_key', value: 'sk-ant-abc123def456ghi789jkl012' }],
          },
        },
      },
    ]);
    expect(codes(workflow)).not.toContain('hardcoded-secret');
  });
});
