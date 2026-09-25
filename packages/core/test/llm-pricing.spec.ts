import { describe, expect, it } from 'vitest';
import { computeCostUsd, matchModelPrice } from '../src/domain/n8n/llm-pricing';

const ENTRIES = [
  { pattern: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 },
  { pattern: 'gpt-4o-mini', inputPerMTok: 0.15, outputPerMTok: 0.6 },
  { pattern: 'claude-sonnet-5', inputPerMTok: 3, outputPerMTok: 15 },
];

describe('matchModelPrice', () => {
  it('préfère la correspondance exacte, insensible à la casse', () => {
    expect(matchModelPrice('GPT-4o', ENTRIES)?.pattern).toBe('gpt-4o');
  });

  it('retombe sur le préfixe le plus long : mini ne paie pas le prix du grand', () => {
    expect(matchModelPrice('gpt-4o-mini-2024-07-18', ENTRIES)?.pattern).toBe('gpt-4o-mini');
    expect(matchModelPrice('gpt-4o-2024-08-06', ENTRIES)?.pattern).toBe('gpt-4o');
  });

  it('renvoie null pour un modèle inconnu ou absent — jamais un prix deviné', () => {
    expect(matchModelPrice('mistral-large', ENTRIES)).toBeNull();
    expect(matchModelPrice(null, ENTRIES)).toBeNull();
  });
});

describe('computeCostUsd', () => {
  it('applique les tarifs input/output par million de tokens', () => {
    const cost = computeCostUsd(
      { promptTokens: 1_000_000, completionTokens: 100_000, totalTokens: 1_100_000 },
      { pattern: 'claude-sonnet-5', inputPerMTok: 3, outputPerMTok: 15 },
    );
    expect(cost).toBeCloseTo(3 + 1.5, 10);
  });
});
