import { ModelCatalogEntry, ModelPricingPort, ModelStatus, ModelTier } from '@nwm/core';

/**
 * Source déclarative des tarifs et capacités : le
 * `model_prices_and_context_window.json` de LiteLLM (MIT), qui suit les pages de
 * prix des providers et déclare, modèle par modèle, la fenêtre de contexte et
 * ce que le modèle sait faire.
 *
 * Déterministe, versionné, rejouable — c'est ce qui en fait la source PRIMAIRE,
 * l'IA ne venant qu'en complément sur ce que ce fichier ne porte pas (statut
 * annoncé, successeur, niveau). Rien n'est appliqué directement : l'appelant en
 * fait des PROPOSITIONS, parce qu'un tarif faux écrit tout seul empoisonne les
 * coûts figés et les alertes sans laisser de trace de sa provenance.
 */

const BLOB_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const REVISION_URL =
  'https://api.github.com/repos/BerriAI/litellm/contents/model_prices_and_context_window.json';

/** Ce qu'on sait traduire ; le reste du fichier (embeddings, audio, images) est ignoré. */
const PROVIDERS: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  vertex_ai: 'google',
  gemini: 'google',
  mistral: 'mistral',
  deepseek: 'deepseek',
};

interface LiteLlmModel {
  litellm_provider?: string;
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_response_schema?: boolean;
  supports_reasoning?: boolean;
  deprecation_date?: string;
}

export class LiteLlmPricingAdapter implements ModelPricingPort {
  async revision(): Promise<string> {
    const response = await fetch(REVISION_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nwm-model-catalog' },
    });
    if (!response.ok) throw new Error(`Révision LiteLLM indisponible (HTTP ${response.status})`);
    const body = (await response.json()) as { sha?: string };
    if (!body.sha) throw new Error('Révision LiteLLM illisible : pas de sha');
    return body.sha;
  }

  async fetchModels(): Promise<ModelCatalogEntry[]> {
    const response = await fetch(BLOB_URL, { headers: { 'User-Agent': 'nwm-model-catalog' } });
    if (!response.ok) throw new Error(`Tarifs LiteLLM indisponibles (HTTP ${response.status})`);
    const body = (await response.json()) as Record<string, LiteLlmModel>;

    const entries: ModelCatalogEntry[] = [];
    for (const [name, model] of Object.entries(body)) {
      if (name === 'sample_spec' || !model || typeof model !== 'object') continue;
      if (model.mode !== 'chat') continue; // embeddings, audio, images : autre unité, autre sujet.
      const provider = PROVIDERS[model.litellm_provider ?? ''];
      if (!provider) continue;
      if (typeof model.input_cost_per_token !== 'number' || typeof model.output_cost_per_token !== 'number')
        continue;
      entries.push({
        // Le fichier préfixe parfois par le provider (`mistral/mistral-small`) :
        // le motif doit rester celui que n8n écrit dans le nœud.
        pattern: name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name,
        provider,
        inputPerMTok: round(model.input_cost_per_token * 1_000_000),
        outputPerMTok: round(model.output_cost_per_token * 1_000_000),
        status: status(model),
        tier: tier(model),
        contextWindow: model.max_input_tokens ?? null,
        // Un booléen ABSENT du fichier reste `null` : ne pas savoir n'est pas
        // « ne sait pas faire », et c'est ce qui empêche l'audit d'accuser à tort.
        supportsVision: bool(model.supports_vision),
        supportsTools: bool(model.supports_function_calling),
        supportsStructuredOutput: bool(model.supports_response_schema),
        retiresAt: model.deprecation_date ?? null,
      });
    }
    return entries;
  }
}

function status(model: LiteLlmModel): ModelStatus {
  if (!model.deprecation_date) return 'active';
  const date = new Date(model.deprecation_date);
  if (Number.isNaN(date.getTime())) return 'active';
  return date.getTime() < Date.now() ? 'retired' : 'deprecated';
}

/**
 * Le fichier ne porte pas de « niveau » : on le déduit du raisonnement déclaré,
 * et à défaut du PRIX, qui est le seul signal disponible et se corrige à la main.
 * C'est exactement ce que le rafraîchissement IA vient affiner ensuite.
 */
function tier(model: LiteLlmModel): ModelTier {
  if (model.supports_reasoning) return 'reasoning';
  const perMTok = (model.input_cost_per_token ?? 0) * 1_000_000;
  if (perMTok >= 5) return 'reasoning';
  return perMTok <= 0.6 ? 'light' : 'standard';
}

function bool(value: boolean | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
