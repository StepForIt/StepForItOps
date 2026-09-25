import { describe, expect, it } from 'vitest';
import { extractLlmUsage, workflowHasLlmNodes } from '../src/domain/n8n/llm-usage';

/** Fabrique le champ `data` d'une exécution avec un run de sub-node Chat Model. */
function executionData(runData: Record<string, unknown>): unknown {
  return { resultData: { runData } };
}

const chatModelRun = (json: Record<string, unknown>, options?: Record<string, unknown>) => ({
  startTime: 1,
  executionTime: 5,
  data: { ai_languageModel: [[{ json }]] },
  ...(options
    ? {
        inputOverride: {
          ai_languageModel: [[{ json: { messages: [], estimatedTokens: 10, options } }]],
        },
      }
    : {}),
});

describe('extractLlmUsage', () => {
  it('lit tokenUsage réel avec le modèle depuis l’input du sub-node', () => {
    const data = executionData({
      'Anthropic Chat Model': [
        chatModelRun(
          { response: {}, tokenUsage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 } },
          { model: 'claude-sonnet-5' },
        ),
      ],
    });
    expect(extractLlmUsage(data)).toEqual([
      {
        nodeName: 'Anthropic Chat Model',
        runIndex: 0,
        callIndex: 0,
        itemIndex: 0,
        model: 'claude-sonnet-5',
        isEstimate: false,
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
      },
    ]);
  });

  it('marque isEstimate quand seul tokenUsageEstimate est présent', () => {
    const data = executionData({
      'OpenAI Chat Model': [
        chatModelRun({ tokenUsageEstimate: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } }),
      ],
    });
    const [call] = extractLlmUsage(data);
    expect(call.isEstimate).toBe(true);
    expect(call.model).toBeNull();
    expect(call.totalTokens).toBe(60);
  });

  it('ressort un enregistrement par run et par appel (agent multi-tours)', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    const data = executionData({
      'Chat Model': [
        chatModelRun({ tokenUsage: usage }, { model: 'gpt-4o' }),
        chatModelRun({ tokenUsage: usage }, { model: 'gpt-4o' }),
      ],
      'Un nœud Set': [{ data: { main: [[{ json: { foo: 1 } }]] } }],
    });
    const calls = extractLlmUsage(data);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.runIndex)).toEqual([0, 1]);
  });

  it('complète totalTokens manquant et ignore les formes inattendues', () => {
    const data = executionData({
      'Chat Model': [chatModelRun({ tokenUsage: { promptTokens: 7, completionTokens: 3 } })],
      Bizarre: [{ data: { ai_languageModel: [[{ json: { tokenUsage: 'n/a' } }]] } }],
    });
    const calls = extractLlmUsage(data);
    expect(calls).toHaveLength(1);
    expect(calls[0].totalTokens).toBe(10);
  });

  it('accepte le data en chaîne JSON (anciennes versions de n8n)', () => {
    const data = executionData({
      'Chat Model': [chatModelRun({ tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } })],
    });
    expect(extractLlmUsage(JSON.stringify(data))).toHaveLength(1);
    expect(extractLlmUsage('pas du json')).toEqual([]);
  });

  it('ne plante pas sur une exécution sans données', () => {
    expect(extractLlmUsage(undefined)).toEqual([]);
    expect(extractLlmUsage({})).toEqual([]);
    expect(extractLlmUsage({ resultData: {} })).toEqual([]);
  });
});

describe('workflowHasLlmNodes', () => {
  it('détecte les nœuds modèle LangChain, pas les autres', () => {
    expect(
      workflowHasLlmNodes({
        nodes: [
          { name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
          { name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic' },
        ],
      }),
    ).toBe(true);
    expect(
      workflowHasLlmNodes({
        nodes: [{ name: 'HTTP', type: 'n8n-nodes-base.httpRequest' }],
      }),
    ).toBe(false);
  });
});
