import { describe, expect, it } from 'vitest';
import {
  detectLlmHttpNodes,
  detectLlmOutputNodes,
  detectSimplifiedOutputNodes,
  extractHttpLlmUsage,
} from '../src/domain/n8n/llm-http-usage';

const HTTP_NODE = (name: string, url: string, disabled = false) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  disabled,
  parameters: { url },
});

const runWith = (json: Record<string, unknown>) => ({
  data: { main: [[{ json }]] },
});

describe('detectLlmHttpNodes', () => {
  it('retient les HTTP Request qui visent un provider LLM, actifs seulement', () => {
    const nodes = detectLlmHttpNodes({
      nodes: [
        HTTP_NODE('OpenAI direct', 'https://api.openai.com/v1/chat/completions'),
        HTTP_NODE('Anthropic direct', 'https://api.anthropic.com/v1/messages'),
        HTTP_NODE('CRM', 'https://api.moncrm.io/v1/contacts'),
        HTTP_NODE('Désactivé', 'https://api.openai.com/v1/chat/completions', true),
        { name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
      ],
    });
    expect(nodes).toEqual(['OpenAI direct', 'Anthropic direct']);
  });
});

describe('extractHttpLlmUsage', () => {
  const data = (runData: Record<string, unknown>) => ({ resultData: { runData } });

  it('lit la forme OpenAI (prompt_tokens/completion_tokens) et le modèle', () => {
    const calls = extractHttpLlmUsage(
      data({
        'OpenAI direct': [
          runWith({
            model: 'gpt-4o-mini-2024-07-18',
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          }),
        ],
      }),
      ['OpenAI direct'],
    );
    expect(calls).toEqual([
      {
        nodeName: 'OpenAI direct',
        runIndex: 0,
        callIndex: 0,
        itemIndex: 0,
        model: 'gpt-4o-mini-2024-07-18',
        isEstimate: false,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      },
    ]);
  });

  it('lit la forme Anthropic en fusionnant les tokens de cache dans le prompt', () => {
    const [call] = extractHttpLlmUsage(
      data({
        'Anthropic direct': [
          runWith({
            model: 'claude-sonnet-5',
            usage: {
              input_tokens: 50,
              output_tokens: 10,
              cache_creation_input_tokens: 200,
              cache_read_input_tokens: 1000,
            },
          }),
        ],
      }),
      ['Anthropic direct'],
    );
    expect(call.promptTokens).toBe(1250);
    expect(call.completionTokens).toBe(10);
    expect(call.totalTokens).toBe(1260);
  });

  it('ignore les nœuds non listés, les sorties sans usage et les formes inconnues', () => {
    const calls = extractHttpLlmUsage(
      data({
        CRM: [runWith({ usage: { credits: 3 } })],
        'OpenAI direct': [runWith({ ok: true })],
      }),
      ['OpenAI direct'],
    );
    expect(calls).toEqual([]);
  });
});

describe('detectLlmOutputNodes', () => {
  const vendor = (name: string, type: string, disabled = false) => ({ name, type, disabled });

  it('retient les nœuds vendeurs qui appellent un modèle par eux-mêmes', () => {
    // Le nœud OpenAI posé seul (« Message a model ») ne porte pas de sous-nœud
    // Chat Model : sans lui, un workflow entier d'appels IA passait inaperçu.
    const nodes = detectLlmOutputNodes({
      nodes: [
        vendor('OpenAI', '@n8n/n8n-nodes-langchain.openAi'),
        vendor('OpenAI legacy', 'n8n-nodes-base.openAi'),
        vendor('Gemini', '@n8n/n8n-nodes-langchain.googleGemini'),
        vendor('Anthropic', '@n8n/n8n-nodes-langchain.anthropic'),
        vendor('Mistral', 'n8n-nodes-base.mistralAi'),
      ],
    });

    expect(nodes).toEqual(['OpenAI', 'OpenAI legacy', 'Gemini', 'Anthropic', 'Mistral']);
  });

  it('ignore un nœud vendeur désactivé, et ce qui ne parle pas à un modèle', () => {
    const nodes = detectLlmOutputNodes({
      nodes: [
        vendor('OpenAI off', '@n8n/n8n-nodes-langchain.openAi', true),
        vendor('Slack', 'n8n-nodes-base.slack'),
        // Sous-nœud Chat Model : sa consommation est lue ailleurs (extractLlmUsage),
        // la compter ici la compterait deux fois.
        vendor('Chat Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi'),
      ],
    });

    expect(nodes).toEqual([]);
  });

  it('garde les HTTP Request vers un provider, dans le même appel', () => {
    const nodes = detectLlmOutputNodes({
      nodes: [
        HTTP_NODE('OpenAI direct', 'https://api.openai.com/v1/chat/completions'),
        vendor('OpenAI', '@n8n/n8n-nodes-langchain.openAi'),
      ],
    });

    expect(nodes).toEqual(['OpenAI direct', 'OpenAI']);
  });
});

describe('detectSimplifiedOutputNodes', () => {
  const openAi = (name: string, parameters: Record<string, unknown>, disabled = false) => ({
    name,
    type: '@n8n/n8n-nodes-langchain.openAi',
    disabled,
    parameters,
  });

  it('signale un nœud vendeur sans option simplify (défaut n8n : activé)', () => {
    expect(detectSimplifiedOutputNodes({ nodes: [openAi('Message a model', { options: {} })] })).toEqual([
      'Message a model',
    ]);
  });

  it("laisse passer un nœud dont Simplify est désactivé, où que vive l'option", () => {
    const nodes = [openAi('A', { simplify: false }), openAi('B', { options: { simplify: false } })];
    expect(detectSimplifiedOutputNodes({ nodes })).toEqual([]);
  });

  it("ignore un nœud désactivé et un nœud qui n'est pas un vendeur", () => {
    const nodes = [openAi('Off', {}, true), { name: 'Set', type: 'n8n-nodes-base.set', parameters: {} }];
    expect(detectSimplifiedOutputNodes({ nodes })).toEqual([]);
  });
});
