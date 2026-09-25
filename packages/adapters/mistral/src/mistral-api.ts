/**
 * Transport HTTP vers l'API Mistral. Pas de SDK : `@mistralai/mistralai` v2 est
 * publié en ESM seul, quand l'API est compilée en CommonJS — et les autres
 * adapters de la maison (n8n, GitHub, Drive, Kuma) parlent déjà en `fetch`.
 */

const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

/** Un morceau de message : Mistral n'accepte les images que sous cette forme. */
export type MistralContent =
  string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: string }>;

export interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: MistralContent | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
}

export interface MistralToolCall {
  id: string;
  type?: 'function';
  /** `arguments` est une CHAÎNE de JSON, jamais un objet — c'est ce que rend l'API. */
  function: { name: string; arguments: string };
}

export interface MistralToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface MistralRequest {
  model: string;
  messages: MistralMessage[];
  max_tokens?: number;
  tools?: MistralToolDef[];
  tool_choice?: 'auto' | 'none' | 'any';
  response_format?: { type: 'json_object' };
}

export interface MistralChoice {
  message: { role: string; content?: MistralContent | null; tool_calls?: MistralToolCall[] };
  finish_reason?: string;
}

export interface MistralResponse {
  choices: MistralChoice[];
}

/**
 * Appelle l'API et rend la réponse parsée. Le corps d'erreur est repris TEL QUEL
 * dans le message : c'est là que le fournisseur dit ce qui bloque réellement
 * (plafond de dépense, modèle inconnu, clé révoquée).
 */
export async function callMistral(apiKey: string, body: MistralRequest): Promise<MistralResponse> {
  const response = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw new Error(`Mistral ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return (await response.json()) as MistralResponse;
}

/** Le texte d'un choix, quelle que soit la forme rendue (chaîne ou morceaux). */
export function textOfContent(content: MistralContent | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((chunk): chunk is { type: 'text'; text: string } => chunk.type === 'text')
    .map((chunk) => chunk.text)
    .join('\n');
}
