import { NotificationMessage, NotificationPort } from '@nwm/core';

const TIMEOUT_MS = 10_000;

/**
 * Envoi de notifications par simple HTTP sortant : Slack en « incoming
 * webhook » (juste une URL à coller, aucune app à installer) et webhook
 * générique en POST JSON (n8n, Discord, Teams, ce qu'on veut derrière).
 */
export class NotificationAdapter implements NotificationPort {
  async sendSlack(webhookUrl: string, message: NotificationMessage): Promise<void> {
    // mrkdwn Slack : le titre en gras, le lien en fin — sobre et lisible sur mobile.
    const text = [
      `*${message.title}*`,
      message.body,
      ...(message.url ? [`<${message.url}|Ouvrir dans la plateforme>`] : []),
    ].join('\n');
    await post(webhookUrl, { text }, 'Slack');
  }

  async sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
    await post(url, payload, 'Webhook');
  }
}

async function post(url: string, payload: unknown, label: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${label} → ${response.status}`);
  }
}
