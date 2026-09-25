import { N8nWorkflow } from './workflow.types';

/**
 * Extraction de la consommation LLM depuis le runData d'une exécution n8n.
 *
 * Les nœuds Chat Model (sub-nodes LangChain) écrivent leur usage via le callback
 * `N8nLlmTracing` dans leurs propres données d'exécution, sur la connexion
 * `ai_languageModel` : `tokenUsage` quand le provider a renvoyé les chiffres réels,
 * `tokenUsageEstimate` (estimation tiktoken) sinon — les deux mutuellement exclusifs.
 * L'AI Agent ne propage rien : tout se lit dans le runData du sub-node.
 */

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCallUsage extends LlmTokenUsage {
  nodeName: string;
  runIndex: number;
  /** Position de l'appel dans la sortie du run (un run peut porter plusieurs appels). */
  callIndex: number;
  itemIndex: number;
  /** Nom du modèle lu dans l'input du sub-node ; null si introuvable. */
  model: string | null;
  /** true quand seul `tokenUsageEstimate` était présent (streaming, provider muet). */
  isEstimate: boolean;
}

const LLM_CONNECTION = 'ai_languageModel';

/** Le workflow contient-il au moins un nœud modèle LangChain (candidat au poll détaillé) ? */
export function workflowHasLlmNodes(workflow: Pick<N8nWorkflow, 'nodes'>): boolean {
  return (workflow.nodes ?? []).some(
    (node) => typeof node.type === 'string' && node.type.startsWith('@n8n/n8n-nodes-langchain.lm'),
  );
}

/**
 * Parcourt `data.resultData.runData` d'une exécution (`includeData=true`) et ressort
 * un enregistrement par appel LLM. `executionData` est le champ `data` brut de
 * l'exécution : tout est lu défensivement, une forme inattendue donne juste zéro ligne.
 */
/**
 * Le `runData` d'une exécution, quelle que soit la forme du champ `data` :
 * objet ou chaîne JSON selon la version de n8n. Null si la forme est inconnue.
 */
export function executionRunData(executionData: unknown): Record<string, unknown> | null {
  if (typeof executionData === 'string') {
    try {
      executionData = JSON.parse(executionData);
    } catch {
      return null;
    }
  }
  return asRecord(asRecord(asRecord(executionData)?.resultData)?.runData);
}

export function extractLlmUsage(executionData: unknown): LlmCallUsage[] {
  const runData = executionRunData(executionData);
  if (!runData) return [];

  const calls: LlmCallUsage[] = [];
  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs)) continue;
    runs.forEach((run, runIndex) => {
      const outputs = asRecord(asRecord(run)?.data)?.[LLM_CONNECTION];
      if (!Array.isArray(outputs)) return;
      const model = findModel(asRecord(run));
      outputs.forEach((items, callIndex) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, itemIndex) => {
          const json = asRecord(asRecord(item)?.json);
          if (!json) return;
          const real = asUsage(json.tokenUsage);
          const estimate = real ? null : asUsage(json.tokenUsageEstimate);
          const usage = real ?? estimate;
          if (!usage) return;
          calls.push({
            nodeName,
            runIndex,
            callIndex,
            itemIndex,
            model,
            isEstimate: real === null,
            ...usage,
          });
        });
      });
    });
  }
  return calls;
}

/**
 * Le nom du modèle n'est pas dans `tokenUsage` : il vit dans l'input du sub-node
 * (`inputOverride`), champ `options` — les kwargs sérialisés du LLM par LangChain.
 */
function findModel(run: Record<string, unknown> | null): string | null {
  const inputs = asRecord(run?.inputOverride)?.[LLM_CONNECTION];
  if (!Array.isArray(inputs)) return null;
  for (const items of inputs) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const json = asRecord(asRecord(item)?.json);
      if (!json) continue;
      const options = asRecord(json.options);
      for (const key of ['model', 'modelName', 'model_name', 'deploymentName']) {
        const value = options?.[key] ?? json[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }
  return null;
}

function asUsage(value: unknown): LlmTokenUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const promptTokens = asCount(record.promptTokens);
  const completionTokens = asCount(record.completionTokens);
  if (promptTokens === null && completionTokens === null) return null;
  const totalTokens = asCount(record.totalTokens) ?? (promptTokens ?? 0) + (completionTokens ?? 0);
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens,
  };
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Partagé avec llm-http-usage.ts, qui lit les mêmes structures. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
