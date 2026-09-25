import { LlmTokenUsage } from './llm-usage';

/**
 * Tarification d'un appel LLM : tokens → dollars, depuis une table de prix par
 * modèle. Un modèle sans correspondance ressort à `null`, jamais un prix deviné —
 * c'est la règle commune à Langfuse et Helicone, un zéro serait un mensonge.
 */

export interface ModelPriceEntry {
  /** Motif de correspondance : nom exact ou préfixe, insensible à la casse. */
  pattern: string;
  /** USD par million de tokens d'entrée. */
  inputPerMTok: number;
  /** USD par million de tokens de sortie. */
  outputPerMTok: number;
}

/**
 * Correspondance exacte d'abord, puis le préfixe le plus long : `claude-sonnet-5`
 * matche l'entrée `claude-sonnet-5` avant l'entrée `claude`, et un id daté
 * (`gpt-4o-2024-08-06`) retombe sur `gpt-4o`.
 */
export function matchModelPrice<T extends ModelPriceEntry>(model: string | null, entries: T[]): T | null {
  if (!model) return null;
  const needle = model.toLowerCase();
  let best: T | null = null;
  for (const entry of entries) {
    const pattern = entry.pattern.toLowerCase();
    if (pattern === needle) return entry;
    if (needle.startsWith(pattern) && (!best || pattern.length > best.pattern.length)) {
      best = entry;
    }
  }
  return best;
}

/** Coût d'un appel en USD ; les tarifs de la table sont par million de tokens. */
export function computeCostUsd(usage: LlmTokenUsage, price: ModelPriceEntry): number {
  return (usage.promptTokens * price.inputPerMTok + usage.completionTokens * price.outputPerMTok) / 1_000_000;
}
