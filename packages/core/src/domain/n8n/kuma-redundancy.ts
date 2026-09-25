import { extractUrlHost, extractWebhookPath } from './webhook-url';

/**
 * Sondes Kuma rendues redondantes par l'error-watch passif : elles font double
 * emploi, au pire en générant une exécution n8n à chaque check. Ce module ne
 * fait qu'identifier — la liste est revue avant toute écriture.
 */

export type RedundancyRule =
  /** Sonde HTTP/keyword qui tape un webhook n8n → une exécution à chaque check. */
  | 'health-webhook'
  /** Sonde push alimentée par un workflow « Errors Check » que l'error-watch remplace. */
  | 'duplicate-error-watch'
  /** Sonde en pause côté externe alors que le monitor local est activé → surveille dans le vide. */
  | 'paused';

/** Sonde externe, réduite aux champs qui servent au classement. */
export interface RedundancyProbe {
  externalId: number;
  name: string;
  /** Type natif du système externe (push, http, keyword…). */
  type: string;
  active: boolean;
  intervalSeconds?: number;
  url?: string;
}

/** Instance n8n connue de la plateforme. */
export interface RedundancyInstance {
  id: string;
  name: string;
  baseUrl: string;
  /** La plateforme surveille déjà les erreurs de cette instance (monitor error-watch activé). */
  hasErrorWatch: boolean;
}

export interface RedundancyContext {
  probes: RedundancyProbe[];
  instances: RedundancyInstance[];
  /**
   * Sondes créées par la plateforme elle-même (Monitor.config.kumaMonitorId hors import).
   * Jamais candidates : les désactiver couperait le monitoring qu'on vient de mettre en place.
   */
  ownedExternalIds: number[];
  /** Sondes rattachées à un monitor local activé (importées puis laissées actives côté plateforme). */
  linkedEnabledExternalIds: number[];
}

export interface RedundantProbe {
  externalId: number;
  name: string;
  rule: RedundancyRule;
  /** Phrase affichée à la revue : pourquoi cette sonde est candidate. */
  reason: string;
  /** Instance couverte par la plateforme qui rend la sonde redondante, si identifiée. */
  instanceName?: string;
  /** Exécutions n8n déclenchées par jour (règle health-webhook), pour chiffrer le gain. */
  executionsPerDay?: number;
}

const SECONDS_PER_DAY = 86400;

/**
 * Classe les sondes externes candidates à la désactivation. Une sonde ne relève que d'une règle :
 * la première qui s'applique dans l'ordre `paused` → `duplicate-error-watch` → `health-webhook`.
 */
export function findRedundantProbes(context: RedundancyContext): RedundantProbe[] {
  const owned = new Set(context.ownedExternalIds);
  const linkedEnabled = new Set(context.linkedEnabledExternalIds);
  const watched = context.instances.filter((instance) => instance.hasErrorWatch);

  const redundant: RedundantProbe[] = [];
  for (const probe of context.probes) {
    if (owned.has(probe.externalId)) continue;
    const found =
      pausedButEnabled(probe, linkedEnabled) ??
      duplicateErrorWatch(probe, watched) ??
      healthWebhook(probe, watched);
    if (found) redundant.push(found);
  }
  return redundant;
}

function pausedButEnabled(probe: RedundancyProbe, linkedEnabled: Set<number>): RedundantProbe | null {
  if (probe.active || !linkedEnabled.has(probe.externalId)) return null;
  return {
    externalId: probe.externalId,
    name: probe.name,
    rule: 'paused',
    reason:
      'En pause côté Uptime Kuma alors que son monitor est activé dans la plateforme : elle ne surveille plus rien.',
  };
}

function duplicateErrorWatch(probe: RedundancyProbe, watched: RedundancyInstance[]): RedundantProbe | null {
  if (probe.type !== 'push' || !isErrorCheckName(probe.name)) return null;
  const instance = watched.find((candidate) => namesReferToSame(probe.name, candidate.name));
  if (!instance) return null;
  return {
    externalId: probe.externalId,
    name: probe.name,
    rule: 'duplicate-error-watch',
    reason: `Doublon du monitor error-watch de « ${instance.name} », qui détecte les mêmes erreurs sans workflow dédié.`,
    instanceName: instance.name,
  };
}

function healthWebhook(probe: RedundancyProbe, watched: RedundancyInstance[]): RedundantProbe | null {
  if (probe.type === 'push' || !probe.url || extractWebhookPath(probe.url) === null) return null;
  const host = extractUrlHost(probe.url);
  const instance = watched.find((candidate) => extractUrlHost(candidate.baseUrl) === host);
  if (!instance) return null;

  const interval = probe.intervalSeconds;
  const executionsPerDay = interval && interval > 0 ? Math.round(SECONDS_PER_DAY / interval) : undefined;
  const cost = executionsPerDay ? ` (~${executionsPerDay} exécutions/jour)` : '';
  return {
    externalId: probe.externalId,
    name: probe.name,
    rule: 'health-webhook',
    reason: `Appelle un webhook de « ${instance.name} » à chaque check${cost} ; l'error-watch détecte les échecs sans rien exécuter.`,
    instanceName: instance.name,
    executionsPerDay,
  };
}

/** Sonde push alimentée par un workflow de contrôle d'erreurs (« … Errors Check »). */
function isErrorCheckName(name: string): boolean {
  return /error[s]?\s*(check|watch)|erreurs?\s+d['’]ex[ée]cution/i.test(name);
}

/**
 * Les noms de sondes reprennent le client, pas le libellé exact de l'instance
 * (« [ACME] Errors Check » ↔ « N8N acme », « [Fabrique à Bidules] … » ↔ « La fabrique a bidules ») :
 * comparaison sur les caractères alphanumériques sans accents, par inclusion.
 */
function namesReferToSame(probeName: string, instanceName: string): boolean {
  const probe = normalizeName(probeName);
  const instance = normalizeName(instanceName);
  if (!probe || !instance) return false;
  return probe.includes(instance) || instance.includes(probe);
}

/** Retire le préfixe entre crochets utilisé comme libellé de client, puis réduit aux alphanumériques. */
function normalizeName(name: string): string {
  const label = /^\s*\[([^\]]+)\]/.exec(name)?.[1] ?? name;
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
