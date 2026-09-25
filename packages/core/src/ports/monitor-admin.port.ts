/** Sonde push créée dans le système de monitoring externe. */
export interface ProvisionedProbe {
  externalId: number;
  pushToken: string;
  pushUrl: string;
}

/** Identifiants admin du système de monitoring externe. */
export interface MonitorAdminCredentials {
  url: string;
  username: string;
  password: string;
}

/** Monitor existant côté système externe (import de sondes pré-existantes). */
export interface ExternalProbe {
  externalId: number;
  name: string;
  /** Type natif du système externe (push, http, ping…). Seul "push" est importable en heartbeat. */
  type: string;
  active: boolean;
  intervalSeconds?: number;
  /** Uniquement pour les monitors de type push. */
  pushUrl?: string;
  /** URL surveillée (types http, keyword, ping…) : sert au rattachement workflow via webhook. */
  url?: string;
  /** Étiquettes déjà portées par la sonde côté système externe. */
  tags?: ExternalTag[];
}

/** Étiquette du système externe (Uptime Kuma : tag global, réutilisable sur plusieurs sondes). */
export interface ExternalTag {
  id: number;
  name: string;
  color: string;
}

/** Nouvel intervalle attendu pour une sonde push existante. */
export interface ProbeIntervalUpdate {
  externalId: number;
  intervalSeconds: number;
}

/**
 * Port d'administration du monitoring externe (ex: Uptime Kuma via Socket.io) :
 * création / suppression de sondes, par opposition à MonitorPort qui ne fait que pousser.
 * Les credentials sont résolus à chaque appel (réglages en DB, variables d'env en fallback),
 * d'où les signatures async.
 */
export interface MonitorAdminPort {
  isConfigured(): Promise<boolean>;
  /** Connexion + login, sans effet de bord. Credentials explicites, ou courants si omis. Rejette si KO. */
  testConnection(credentials?: MonitorAdminCredentials): Promise<void>;
  createPushProbe(name: string, intervalSeconds?: number): Promise<ProvisionedProbe>;
  deleteProbe(externalId: number): Promise<void>;
  /**
   * Réaligne l'intervalle attendu de sondes existantes sur la cadence réelle de push
   * (une sonde qui attend un beat plus souvent qu'on ne pousse tombe DOWN sans raison).
   */
  setProbeIntervals(updates: ProbeIntervalUpdate[]): Promise<void>;
  /** Liste les monitors existants côté système externe (tous types). */
  listProbes(): Promise<ExternalProbe[]>;
  /** Étiquette de ce nom, créée si elle n'existe pas encore. */
  ensureTag(name: string, color: string): Promise<ExternalTag>;
  /** Pose une étiquette sur des sondes. Les sondes qui la portent déjà sont ignorées. */
  tagProbes(tagId: number, externalIds: number[]): Promise<void>;
}

export const MONITOR_ADMIN_PORT = Symbol('MONITOR_ADMIN_PORT');
