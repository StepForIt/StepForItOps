import { N8nWorkflow } from './workflow.types';
import { declaredEntryPath, hasEntryUrl } from './entry-path';

/**
 * Correspondance URL de ping ↔ webhook n8n : permet de rattacher un monitor
 * externe (ex: sonde HTTP/keyword Uptime Kuma) au workflow qu'il surveille.
 */

const WEBHOOK_URL_RE = /\/(?:webhook|webhook-test)\/([^?#]+)/;

/** Chemin de webhook contenu dans une URL (…/webhook/<path> ou …/webhook-test/<path>), sinon null. */
export function extractWebhookPath(url: string): string | null {
  const match = WEBHOOK_URL_RE.exec(url);
  return match ? normalizeWebhookPath(match[1]) : null;
}

/** Hôte d'une URL (pour départager deux instances exposant le même chemin), sinon null. */
export function extractUrlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function normalizeWebhookPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/** Chemins de webhook exposés par un workflow (path déclaré, repli sur le webhookId). */
export function workflowWebhookPaths(workflow: N8nWorkflow): string[] {
  const paths: string[] = [];
  for (const node of workflow.nodes ?? []) {
    if (node.disabled || !hasEntryUrl(node)) continue;
    const value = declaredEntryPath(node) ?? node.webhookId;
    if (value) paths.push(normalizeWebhookPath(value));
  }
  return paths;
}
