import { N8nApiError, N8nInstanceConfig } from '@nwm/core';

/**
 * Corps d'erreur conservé. n8n énumère les nœuds fautifs quand il refuse
 * d'enregistrer un workflow : coupé trop court, ce refus ne citait qu'une partie
 * d'entre eux, et le reste du message était perdu pour celui qui doit décider.
 */
const MAX_ERROR_BODY = 4000;

/** Client HTTP minimal vers l'API publique n8n (/api/v1). */
export async function n8nRequest<T>(
  instance: N8nInstanceConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${instance.baseUrl.replace(/\/$/, '')}/api/v1${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'X-N8N-API-KEY': instance.apiKey,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new N8nApiError(
      `n8n API ${method} ${path} → ${response.status}: ${text.slice(0, MAX_ERROR_BODY)}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
