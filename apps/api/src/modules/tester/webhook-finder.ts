import { N8nWorkflow } from '@nwm/core';

/** Trouve le premier nœud Webhook d'un workflow (path, méthode, et son nom). */
export function findWebhookPath(
  workflow: N8nWorkflow,
): { path: string; method: string; node: string } | null {
  const webhook = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled);
  if (!webhook) return null;
  const p = webhook.parameters ?? {};
  const path = p['path'] as string | undefined;
  if (!path) return null;
  return { path, method: ((p['httpMethod'] as string) ?? 'POST').toUpperCase(), node: webhook.name };
}

/**
 * Un path de webhook n'appartient pas à un workflow mais à l'INSTANCE : n8n sert
 * `/webhook/<path>` depuis le workflow actif qui l'enregistre. Une copie « - DEV »
 * garde le path de son original, donc appeler ce path depuis la copie inactive
 * déclenche la PROD — un envoi réel, sous couvert d'un test.
 */
export function findWebhookOwners(
  workflows: Array<{ id: string; name: string; active: boolean; raw: N8nWorkflow }>,
  path: string,
  method: string,
): Array<{ id: string; name: string; active: boolean }> {
  return workflows
    .filter((w) => {
      const webhook = findWebhookPath(w.raw);
      return webhook?.path === path && webhook.method === method;
    })
    .map(({ id, name, active }) => ({ id, name, active }));
}
