import { N8nWorkflow } from './workflow.types';
import { activeParameters } from './inert-params';
import { LlmCallUsage, asRecord, executionRunData } from './llm-usage';

/**
 * Extraction de la consommation LLM des nœuds HTTP Request qui appellent
 * directement l'API d'un provider : le corps de réponse (avec son champ `usage`)
 * est la sortie normale du nœud, sur la connexion `main`. Attention au nœud
 * OpenAI « classique » dont l'option Simplify retire `usage` — ici on ne lit que
 * ce qui est présent, un usage absent donne simplement zéro ligne.
 */

const PROVIDER_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.mistral.ai',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
] as const;

/** Noms des nœuds HTTP Request du workflow qui visent un provider LLM connu. */
export function detectLlmHttpNodes(workflow: Pick<N8nWorkflow, 'nodes'>): string[] {
  return (workflow.nodes ?? [])
    .filter((node) => {
      if (node.type !== 'n8n-nodes-base.httpRequest' || node.disabled) return false;
      const url = activeParameters(node).url;
      return typeof url === 'string' && PROVIDER_HOSTS.some((host) => url.includes(host));
    })
    .map((node) => node.name);
}

/**
 * Nœuds VENDEURS : ceux qui appellent un modèle par eux-mêmes, sans sous-nœud
 * Chat Model — le nœud OpenAI (« Message a model »), Gemini, Anthropic, Mistral…
 * Leur réponse sort sur la connexion `main`, `usage` compris, exactement comme
 * un HTTP Request : c'est le même extracteur qui les lit.
 *
 * Reconnus par le DERNIER segment du type, jamais par le nom complet : le même
 * nœud a vécu sous `n8n-nodes-base.openAi` puis `@n8n/n8n-nodes-langchain.openAi`,
 * et une liste de noms complets périme à chaque déménagement de paquet. Les
 * sous-nœuds `lm*` en sont exclus : leur consommation est lue par
 * `extractLlmUsage`, la compter ici la compterait deux fois.
 */
const VENDOR_NODE_NAMES = new Set([
  'openai',
  'azureopenai',
  'anthropic',
  'googlegemini',
  'googlevertex',
  'mistralai',
  'mistralcloud',
  'deepseek',
  'groq',
  'perplexity',
  'cohere',
  'xai',
  'ollama',
]);

function isVendorNode(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const last = type.split('.').pop() ?? '';
  return VENDOR_NODE_NAMES.has(last.toLowerCase());
}

/**
 * Tous les nœuds dont la SORTIE peut porter la consommation d'un appel LLM :
 * HTTP Request vers un provider connu, et nœuds vendeurs. C'est cette liste que
 * le poll des coûts inspecte.
 */
export function detectLlmOutputNodes(workflow: Pick<N8nWorkflow, 'nodes'>): string[] {
  const http = new Set(detectLlmHttpNodes(workflow));
  return (workflow.nodes ?? [])
    .filter((node) => !node.disabled && (http.has(node.name) || isVendorNode(node.type)))
    .map((node) => node.name);
}

/**
 * Nœuds vendeurs qui portent une option « Simplify Output » (activée par
 * défaut) : elle réduit la sortie au texte et retire `usage`, donc le coût.
 */
const SIMPLIFY_NODE_NAMES = new Set(['openai', 'azureopenai', 'anthropic', 'googlegemini']);

/**
 * Nœuds vendeurs dont la sortie est simplifiée. Un `simplify` absent vaut vrai
 * (défaut de n8n), d'où le nœud « Message a model » sans aucune option : c'est
 * le cas courant. L'option vit à la racine des paramètres, ou dans `options`
 * selon la version du nœud.
 */
export function detectSimplifiedOutputNodes(workflow: Pick<N8nWorkflow, 'nodes'>): string[] {
  return (workflow.nodes ?? [])
    .filter((node) => {
      if (node.disabled || typeof node.type !== 'string') return false;
      const last = (node.type.split('.').pop() ?? '').toLowerCase();
      if (!SIMPLIFY_NODE_NAMES.has(last)) return false;
      const params = activeParameters(node);
      const options = asRecord(params.options);
      return params.simplify !== false && options?.simplify !== false;
    })
    .map((node) => node.name);
}

/**
 * Un enregistrement par item de sortie portant un `usage` de forme connue
 * (OpenAI `prompt_tokens`/`completion_tokens`, Anthropic `input_tokens`/
 * `output_tokens` — tokens de cache fusionnés dans promptTokens, comme le fait
 * n8n pour les nœuds LangChain). Le modèle est lu dans la réponse elle-même.
 */
export function extractHttpLlmUsage(executionData: unknown, nodeNames: string[]): LlmCallUsage[] {
  if (nodeNames.length === 0) return [];
  const runData = executionRunData(executionData);
  if (!runData) return [];

  const calls: LlmCallUsage[] = [];
  for (const nodeName of nodeNames) {
    const runs = runData[nodeName];
    if (!Array.isArray(runs)) continue;
    runs.forEach((run, runIndex) => {
      const outputs = asRecord(asRecord(run)?.data)?.main;
      if (!Array.isArray(outputs)) return;
      outputs.forEach((items, callIndex) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, itemIndex) => {
          const json = asRecord(asRecord(item)?.json);
          const usage = parseUsage(asRecord(json?.usage));
          if (!usage) return;
          const model = typeof json?.model === 'string' && json.model ? json.model : null;
          calls.push({ nodeName, runIndex, callIndex, itemIndex, model, isEstimate: false, ...usage });
        });
      });
    });
  }
  return calls;
}

function parseUsage(usage: Record<string, unknown> | null) {
  if (!usage) return null;
  // Forme OpenAI / OpenRouter / Mistral / DeepSeek.
  const prompt = asCount(usage.prompt_tokens);
  const completion = asCount(usage.completion_tokens);
  if (prompt !== null || completion !== null) {
    return {
      promptTokens: prompt ?? 0,
      completionTokens: completion ?? 0,
      totalTokens: asCount(usage.total_tokens) ?? (prompt ?? 0) + (completion ?? 0),
    };
  }
  // Forme Anthropic.
  const input = asCount(usage.input_tokens);
  const output = asCount(usage.output_tokens);
  if (input !== null || output !== null) {
    const promptTokens =
      (input ?? 0) +
      (asCount(usage.cache_creation_input_tokens) ?? 0) +
      (asCount(usage.cache_read_input_tokens) ?? 0);
    return {
      promptTokens,
      completionTokens: output ?? 0,
      totalTokens: promptTokens + (output ?? 0),
    };
  }
  return null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
