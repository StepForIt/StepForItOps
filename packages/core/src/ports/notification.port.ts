/** Port d'envoi de notifications vers un canal externe (Slack, webhook générique). */

export interface NotificationMessage {
  title: string;
  body: string;
  /** Lien vers la page concernée de la plateforme, si le canal sait l'afficher. */
  url?: string;
}

export interface NotificationPort {
  /** Slack en « incoming webhook » : aucune app à installer, juste une URL. */
  sendSlack(webhookUrl: string, message: NotificationMessage): Promise<void>;
  /** Webhook générique : POST JSON, à brancher sur n8n, Discord, Teams… */
  sendWebhook(url: string, payload: Record<string, unknown>): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
