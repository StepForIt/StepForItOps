import { ModelCatalogEntry } from '@nwm/core';

/**
 * Ce que la plateforme sait des modèles courants au premier démarrage : tarifs
 * en USD par million de tokens, cycle de vie et aptitudes.
 *
 * Snapshot manuel (septembre 2026) inspiré du `model_prices_and_context_window.json`
 * de LiteLLM — à confronter aux pages officielles, ce que fait le rafraîchissement
 * hebdomadaire. Les motifs matchent en exact puis en préfixe : un id daté retombe
 * dessus. Une ligne éditée passe en `custom` et survit au re-seed.
 *
 * Une aptitude laissée `null` est une aptitude qu'on ne connaît PAS : le contrôle
 * correspondant se taira sur ce modèle plutôt que de l'accuser.
 */
export const MODEL_CATALOG_SEED: ModelCatalogEntry[] = [
  // OpenAI
  entry('gpt-5', 'openai', 1.25, 10, { tier: 'reasoning', context: 400_000 }),
  entry('gpt-5-mini', 'openai', 0.25, 2, { tier: 'standard', context: 400_000 }),
  entry('gpt-5-nano', 'openai', 0.05, 0.4, { tier: 'light', context: 400_000 }),
  entry('gpt-4.1', 'openai', 2, 8, { tier: 'standard', context: 1_047_576 }),
  entry('gpt-4.1-mini', 'openai', 0.4, 1.6, { tier: 'light', context: 1_047_576 }),
  entry('gpt-4.1-nano', 'openai', 0.1, 0.4, { tier: 'light', context: 1_047_576 }),
  entry('gpt-4o', 'openai', 2.5, 10, { tier: 'standard', context: 128_000 }),
  entry('gpt-4o-mini', 'openai', 0.15, 0.6, { tier: 'light', context: 128_000 }),
  entry('o3', 'openai', 2, 8, { tier: 'reasoning', context: 200_000 }),
  entry('o4-mini', 'openai', 1.1, 4.4, { tier: 'reasoning', context: 200_000 }),
  entry('gpt-3.5-turbo', 'openai', 0.5, 1.5, {
    tier: 'light',
    context: 16_385,
    status: 'deprecated',
    vision: false,
    structured: false,
    replacedBy: 'gpt-4o-mini',
  }),
  // Anthropic
  entry('claude-opus-5', 'anthropic', 15, 75, { tier: 'reasoning', context: 200_000 }),
  entry('claude-sonnet-5', 'anthropic', 3, 15, { tier: 'standard', context: 200_000 }),
  entry('claude-opus-4', 'anthropic', 15, 75, { tier: 'reasoning', context: 200_000 }),
  entry('claude-sonnet-4', 'anthropic', 3, 15, { tier: 'standard', context: 200_000 }),
  entry('claude-haiku-4', 'anthropic', 1, 5, { tier: 'light', context: 200_000 }),
  entry('claude-3-7-sonnet', 'anthropic', 3, 15, { tier: 'standard', context: 200_000 }),
  entry('claude-3-5-sonnet', 'anthropic', 3, 15, { tier: 'standard', context: 200_000 }),
  entry('claude-3-5-haiku', 'anthropic', 0.8, 4, { tier: 'light', context: 200_000 }),
  entry('claude-3-opus', 'anthropic', 15, 75, {
    tier: 'reasoning',
    context: 200_000,
    status: 'deprecated',
    replacedBy: 'claude-opus-4',
  }),
  entry('claude-3-haiku', 'anthropic', 0.25, 1.25, {
    tier: 'light',
    context: 200_000,
    status: 'deprecated',
    replacedBy: 'claude-3-5-haiku',
  }),
  // Google
  entry('gemini-2.5-pro', 'google', 1.25, 10, { tier: 'reasoning', context: 1_048_576 }),
  entry('gemini-2.5-flash', 'google', 0.3, 2.5, { tier: 'standard', context: 1_048_576 }),
  entry('gemini-2.0-flash', 'google', 0.1, 0.4, { tier: 'light', context: 1_048_576 }),
  entry('gemini-1.5-pro', 'google', 1.25, 5, {
    tier: 'standard',
    context: 2_097_152,
    status: 'deprecated',
    replacedBy: 'gemini-2.5-pro',
  }),
  entry('gemini-1.5-flash', 'google', 0.075, 0.3, {
    tier: 'light',
    context: 1_048_576,
    status: 'deprecated',
    replacedBy: 'gemini-2.0-flash',
  }),
  // Mistral / DeepSeek
  entry('mistral-large', 'mistral', 2, 6, { tier: 'standard', context: 131_072, vision: false }),
  entry('mistral-medium', 'mistral', 0.4, 2, { tier: 'standard', context: 131_072 }),
  entry('mistral-small', 'mistral', 0.1, 0.3, { tier: 'light', context: 131_072 }),
  entry('deepseek-chat', 'deepseek', 0.27, 1.1, { tier: 'standard', context: 128_000, vision: false }),
  entry('deepseek-reasoner', 'deepseek', 0.55, 2.19, {
    tier: 'reasoning',
    context: 128_000,
    vision: false,
    tools: false,
  }),
];

interface SeedOptions {
  tier: ModelCatalogEntry['tier'];
  context: number;
  status?: ModelCatalogEntry['status'];
  replacedBy?: string;
  vision?: boolean;
  tools?: boolean;
  structured?: boolean;
}

function entry(
  pattern: string,
  provider: string,
  inputPerMTok: number,
  outputPerMTok: number,
  options: SeedOptions,
): ModelCatalogEntry {
  return {
    pattern,
    provider,
    inputPerMTok,
    outputPerMTok,
    status: options.status ?? 'active',
    tier: options.tier,
    contextWindow: options.context,
    supportsVision: options.vision ?? true,
    supportsTools: options.tools ?? true,
    supportsStructuredOutput: options.structured ?? true,
    replacedByPattern: options.replacedBy ?? null,
  };
}
