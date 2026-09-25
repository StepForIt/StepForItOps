import { io, Socket } from 'socket.io-client';

export interface KumaCredentials {
  url: string;
  username: string;
  password: string;
}

interface KumaAck {
  ok: boolean;
  msg?: string;
  monitorID?: number;
}

/**
 * Émet un événement Kuma et attend son accusé de réception.
 * `args` est variadique : les handlers Kuma vont de zéro argument ("getTags") à trois
 * ("addMonitorTag"), le callback étant toujours le dernier.
 */
function emitWithAck<T extends KumaAck>(
  socket: Socket,
  event: string,
  args: unknown[] = [],
  timeoutMs = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Uptime Kuma : timeout sur "${event}"`)), timeoutMs);
    socket.emit(event, ...args, (response: T) => {
      clearTimeout(timer);
      if (!response?.ok) reject(new Error(`Uptime Kuma "${event}" : ${response?.msg ?? 'échec'}`));
      else resolve(response);
    });
  });
}

/**
 * Client Socket.io minimal vers Uptime Kuma (pas d'API REST officielle).
 * Une connexion éphémère par opération : connect → login → action → disconnect.
 * `beforeLogin` permet d'enregistrer des listeners sur les événements que Kuma
 * émet spontanément juste après le login (ex: "monitorList").
 */
export async function withKumaSession<T>(
  credentials: KumaCredentials,
  action: (socket: Socket) => Promise<T>,
  beforeLogin?: (socket: Socket) => void,
): Promise<T> {
  const socket = io(credentials.url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Uptime Kuma : connexion impossible')), 10000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Uptime Kuma : ${error.message}`));
      });
    });

    beforeLogin?.(socket);

    await emitWithAck(socket, 'login', [
      { username: credentials.username, password: credentials.password, token: '' },
    ]);

    return await action(socket);
  } finally {
    socket.disconnect();
  }
}

/** Crée un moniteur (l'ack contient monitorID). */
export function addMonitor(socket: Socket, monitor: Record<string, unknown>): Promise<KumaAck> {
  return emitWithAck(socket, 'add', [monitor]);
}

export function deleteMonitor(socket: Socket, monitorId: number): Promise<KumaAck> {
  return emitWithAck(socket, 'deleteMonitor', [monitorId]);
}

interface KumaMonitorAck extends KumaAck {
  monitor?: Record<string, unknown>;
}

/** Lit un moniteur complet. Indispensable avant editMonitor : Kuma réécrit tous les champs. */
export async function getMonitor(socket: Socket, monitorId: number): Promise<Record<string, unknown>> {
  const ack = await emitWithAck<KumaMonitorAck>(socket, 'getMonitor', [monitorId]);
  if (!ack.monitor) throw new Error(`Uptime Kuma : moniteur #${monitorId} introuvable`);
  return ack.monitor;
}

/** Met à jour un moniteur existant. `monitor` doit être l'objet complet renvoyé par getMonitor. */
export function editMonitor(socket: Socket, monitor: Record<string, unknown>): Promise<KumaAck> {
  return emitWithAck(socket, 'editMonitor', [monitor]);
}

/** Étiquette Kuma telle que portée par un monitor (jointure tag ↔ monitor à plat). */
export interface KumaMonitorTag {
  tag_id: number;
  name: string;
  color: string;
}

/** Monitor tel que renvoyé par l'événement "monitorList" de Kuma (champs utiles uniquement). */
export interface KumaMonitorSummary {
  id: number;
  name: string;
  type: string;
  active: boolean;
  interval?: number;
  pushToken?: string;
  url?: string;
  tags?: KumaMonitorTag[];
}

/** Étiquette Kuma dans le référentiel global. */
export interface KumaTag {
  id: number;
  name: string;
  color: string;
}

interface KumaTagsAck extends KumaAck {
  tags?: KumaTag[];
}

export async function getTags(socket: Socket): Promise<KumaTag[]> {
  const ack = await emitWithAck<KumaTagsAck>(socket, 'getTags');
  return ack.tags ?? [];
}

interface KumaTagAck extends KumaAck {
  tag?: KumaTag;
}

/** Crée une étiquette dans le référentiel global (elle n'est encore posée sur aucun monitor). */
export async function addTag(socket: Socket, name: string, color: string): Promise<KumaTag> {
  const ack = await emitWithAck<KumaTagAck>(socket, 'addTag', [{ name, color }]);
  if (!ack.tag?.id) throw new Error('Uptime Kuma : étiquette créée sans identifiant');
  return ack.tag;
}

/**
 * Pose une étiquette sur un monitor. Kuma n'a pas d'upsert : rappeler cet événement sur une
 * paire existante crée une seconde ligne — l'appelant doit filtrer les monitors déjà étiquetés.
 * `value` est le champ libre optionnel de Kuma (tag « clé:valeur »), inutilisé ici.
 */
export function addMonitorTag(socket: Socket, tagId: number, monitorId: number): Promise<KumaAck> {
  return emitWithAck(socket, 'addMonitorTag', [tagId, monitorId, '']);
}

/**
 * Capture l'événement "monitorList" que Kuma émet après un login réussi.
 * À appeler via le hook `beforeLogin` de withKumaSession (sinon l'événement
 * peut être émis avant que le listener soit posé).
 */
export function collectMonitorList(socket: Socket, timeoutMs = 10000): Promise<KumaMonitorSummary[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Uptime Kuma : timeout sur "monitorList"')), timeoutMs);
    socket.once('monitorList', (list: Record<string, KumaMonitorSummary>) => {
      clearTimeout(timer);
      resolve(
        Object.values(list ?? {}).map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          active: Boolean(m.active),
          interval: m.interval,
          pushToken: m.pushToken,
          url: m.url,
          tags: m.tags ?? [],
        })),
      );
    });
  });
}
