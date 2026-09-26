import { randomBytes } from 'crypto';
import {
  ExternalProbe,
  ExternalTag,
  MonitorAdminCredentials,
  MonitorAdminPort,
  ProbeIntervalUpdate,
  ProvisionedProbe,
} from '@nwm/core';
import {
  addMonitor,
  addMonitorTag,
  addTag,
  collectMonitorList,
  deleteMonitor,
  editMonitor,
  getMonitor,
  getTags,
  withKumaSession,
  KumaCredentials,
  KumaMonitorSummary,
} from './kuma-socket.client';

/** Source des credentials, résolue à chaque appel (DB, env…). null = non configuré. */
export type KumaCredentialsProvider = () => Promise<KumaCredentials | null>;

/** Credentials depuis les variables d'environnement (fallback historique). */
export function envKumaCredentials(): KumaCredentials | null {
  const url = process.env.KUMA_URL;
  const username = process.env.KUMA_USERNAME;
  const password = process.env.KUMA_PASSWORD;
  return url && username && password ? { url, username, password } : null;
}

/**
 * Provisioning de sondes Uptime Kuma via Socket.io.
 * Le pushToken est généré par nous et envoyé à la création (comme le fait l'UI Kuma),
 * ce qui permet de construire l'URL de push sans lecture supplémentaire.
 */
export class KumaAdminAdapter implements MonitorAdminPort {
  constructor(
    private readonly credentialsProvider: KumaCredentialsProvider = async () => envKumaCredentials(),
  ) {}

  async isConfigured(): Promise<boolean> {
    return (await this.credentialsProvider()) !== null;
  }

  private async requireCredentials(): Promise<KumaCredentials> {
    const credentials = await this.credentialsProvider();
    if (!credentials) {
      throw new Error(
        'Uptime Kuma is not configured: fill in the Kuma settings or KUMA_URL/KUMA_USERNAME/KUMA_PASSWORD',
      );
    }
    return credentials;
  }

  async testConnection(credentials?: MonitorAdminCredentials): Promise<void> {
    const resolved = credentials ?? (await this.requireCredentials());
    await withKumaSession(resolved, async () => undefined);
  }

  async createPushProbe(name: string, intervalSeconds = 60): Promise<ProvisionedProbe> {
    const credentials = await this.requireCredentials();
    const pushToken = randomBytes(10).toString('hex');

    const ack = await withKumaSession(credentials, (socket) =>
      addMonitor(socket, {
        type: 'push',
        name,
        pushToken,
        interval: intervalSeconds,
        retryInterval: intervalSeconds,
        resendInterval: 0,
        maxretries: 0,
        upsideDown: false,
        notificationIDList: {},
        accepted_statuscodes: ['200-299'],
        // Kuma 2.x : colonne `conditions` NOT NULL, alimentée par JSON.stringify(monitor.conditions)
        // → un champ absent devient NULL et l'insert échoue. Aucune condition ici : tableau vide.
        conditions: [],
      }),
    );
    if (ack.monitorID === undefined) {
      throw new Error('Uptime Kuma: monitorID missing from the response');
    }
    return {
      externalId: ack.monitorID,
      pushToken,
      pushUrl: `${credentials.url.replace(/\/$/, '')}/api/push/${pushToken}`,
    };
  }

  /** Une seule session pour tout le lot : chaque sonde est relue puis réécrite avec le nouvel intervalle. */
  async setProbeIntervals(updates: ProbeIntervalUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const credentials = await this.requireCredentials();
    await withKumaSession(credentials, async (socket) => {
      for (const { externalId, intervalSeconds } of updates) {
        const monitor = await getMonitor(socket, externalId);
        await editMonitor(socket, {
          ...monitor,
          interval: intervalSeconds,
          // maxretries = 0 côté sondes push : retryInterval doit suivre, sinon Kuma
          // repasse à la cadence de retry après le premier beat manquant.
          retryInterval: intervalSeconds,
        });
      }
    });
  }

  async deleteProbe(externalId: number): Promise<void> {
    const credentials = await this.requireCredentials();
    await withKumaSession(credentials, (socket) => deleteMonitor(socket, externalId));
  }

  async listProbes(): Promise<ExternalProbe[]> {
    const credentials = await this.requireCredentials();
    let monitorList: Promise<KumaMonitorSummary[]> = Promise.resolve([]);
    const monitors = await withKumaSession(
      credentials,
      () => monitorList,
      (socket) => {
        monitorList = collectMonitorList(socket);
        // Évite une unhandled rejection si le login échoue avant réception de la liste
        monitorList.catch(() => undefined);
      },
    );
    const baseUrl = credentials.url.replace(/\/$/, '');
    return monitors.map((m) => ({
      externalId: m.id,
      name: m.name,
      type: m.type,
      active: m.active,
      intervalSeconds: m.interval,
      pushUrl: m.type === 'push' && m.pushToken ? `${baseUrl}/api/push/${m.pushToken}` : undefined,
      url: m.url,
      tags: (m.tags ?? []).map((tag) => ({ id: tag.tag_id, name: tag.name, color: tag.color })),
    }));
  }

  /** Kuma n'a pas d'upsert d'étiquette : on relit le référentiel avant de créer. */
  async ensureTag(name: string, color: string): Promise<ExternalTag> {
    const credentials = await this.requireCredentials();
    return withKumaSession(credentials, async (socket) => {
      const existing = (await getTags(socket)).find((tag) => tag.name === name);
      return existing ?? (await addTag(socket, name, color));
    });
  }

  /** Une seule session pour tout le lot. Les sondes portant déjà l'étiquette sont sautées. */
  async tagProbes(tagId: number, externalIds: number[]): Promise<void> {
    if (externalIds.length === 0) return;
    const credentials = await this.requireCredentials();
    const alreadyTagged = new Set(
      (await this.listProbes())
        .filter((probe) => probe.tags?.some((tag) => tag.id === tagId))
        .map((probe) => probe.externalId),
    );
    const missing = externalIds.filter((id) => !alreadyTagged.has(id));
    if (missing.length === 0) return;

    await withKumaSession(credentials, async (socket) => {
      for (const externalId of missing) {
        await addMonitorTag(socket, tagId, externalId);
      }
    });
  }
}
