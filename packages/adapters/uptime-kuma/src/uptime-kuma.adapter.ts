import { MonitorPort } from '@nwm/core';

/**
 * Uptime Kuma en mode "Push monitor" : Kuma fournit une URL de push,
 * on l'appelle avec status/msg/ping. Aucune API privée requise.
 */
export class UptimeKumaAdapter implements MonitorPort {
  async push(pushUrl: string, status: 'up' | 'down', message?: string, pingMs?: number): Promise<void> {
    const url = new URL(pushUrl);
    url.searchParams.set('status', status);
    if (message) url.searchParams.set('msg', message);
    if (pingMs !== undefined) url.searchParams.set('ping', String(Math.round(pingMs)));

    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Uptime Kuma push → ${response.status}`);
    }
  }
}
