/**
 * Une credential de fournisseur IA marche-t-elle encore, et lui reste-t-il du
 * crédit ? — pur et sans IO. L'appel part d'un workflow n8n temporaire authentifié
 * par la credential elle-même : la plateforme n'en détient jamais le secret.
 *
 * Deux niveaux, parce que le second coûte :
 *  - `auth`  : un appel GRATUIT (lister les modèles) qui dit si la clé est acceptée ;
 *  - `quota` : un appel minimal qui GÉNÈRE (un jeton, une phrase d'embedding),
 *    seul moyen de voir un compte à sec — aucun de ces fournisseurs n'expose son
 *    solde par API. Le coût est de l'ordre du millième de centime, mais il existe.
 *
 * On ne rend JAMAIS « il reste N euros » : on ne le sait pas. On sait « refusée »
 * ou « à sec », et c'est la seule panne qui s'annonce par un silence côté n8n.
 */

import { ProbeHttpRequest } from './remote-schema-reads';

export type CredentialCheckLevel = 'auth' | 'quota';

/** `unknown` : la réponse n'est ni un succès ni un refus qu'on sait lire — jamais présentée comme verte. */
export type CredentialVerdict = 'ok' | 'rejected' | 'no-credit' | 'rate-limited' | 'unreachable' | 'unknown';

export interface CredentialCheckSpec {
  provider: string;
  /** Types de credential n8n servis par ce fournisseur. */
  types: string[];
  /** Appel gratuit. Absent quand le fournisseur n'en offre pas : on retombe alors sur `quota`. */
  auth?: ProbeHttpRequest;
  /** Appel minimal qui génère, donc qui voit un compte à sec. */
  quota: ProbeHttpRequest;
}

const PING = 'ping';

export const CREDENTIAL_CHECKS: CredentialCheckSpec[] = [
  {
    provider: 'openai',
    types: ['openAiApi'],
    auth: { url: 'https://api.openai.com/v1/models' },
    quota: {
      url: 'https://api.openai.com/v1/embeddings',
      method: 'POST',
      jsonBody: { model: 'text-embedding-3-small', input: PING },
    },
  },
  {
    provider: 'anthropic',
    types: ['anthropicApi'],
    auth: { url: 'https://api.anthropic.com/v1/models', headers: { 'anthropic-version': '2023-06-01' } },
    quota: {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'anthropic-version': '2023-06-01' },
      jsonBody: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: PING }],
      },
    },
  },
  {
    provider: 'mistral',
    types: ['mistralCloudApi'],
    auth: { url: 'https://api.mistral.ai/v1/models' },
    quota: {
      url: 'https://api.mistral.ai/v1/embeddings',
      method: 'POST',
      jsonBody: { model: 'mistral-embed', input: [PING] },
    },
  },
  {
    // Pas de listing gratuit chez Perplexity : les deux niveaux font le même appel d'un jeton.
    provider: 'perplexity',
    types: ['perplexityApi'],
    quota: {
      url: 'https://api.perplexity.ai/chat/completions',
      method: 'POST',
      jsonBody: { model: 'sonar', max_tokens: 1, messages: [{ role: 'user', content: PING }] },
    },
  },
];

export function credentialCheckFor(credentialType: string): CredentialCheckSpec | null {
  return CREDENTIAL_CHECKS.find((spec) => spec.types.includes(credentialType)) ?? null;
}

/** La requête à jouer pour ce niveau ; `auth` se rabat sur `quota` quand le fournisseur n'a rien de gratuit. */
export function credentialProbeRequest(
  spec: CredentialCheckSpec,
  level: CredentialCheckLevel,
): ProbeHttpRequest {
  return level === 'auth' ? (spec.auth ?? spec.quota) : spec.quota;
}

/** Vrai quand le niveau `quota` apporte quelque chose de plus que `auth`. */
export function hasQuotaCheck(spec: CredentialCheckSpec): boolean {
  return spec.auth !== undefined;
}

export interface CredentialProbeOutcome {
  /** Statut HTTP du fournisseur ; absent si l'appel n'a pas abouti (DNS, TLS, credential absente). */
  status?: number;
  /** Message du fournisseur, déjà extrait. */
  detail?: string;
}

const NO_CREDIT = [
  'insufficient_quota',
  'insufficient_funds',
  'billing',
  'credit balance',
  'out of credit',
  'exceeded your current quota',
  'payment required',
];

/**
 * Le verdict d'une réponse. Le 429 est le piège : il dit tantôt « trop vite »
 * (réessayer plus tard, la credential est bonne), tantôt « plus de crédit »
 * (OpenAI : `insufficient_quota`). Les confondre ferait alerter sur une clé saine
 * ou taire un compte à sec — d'où la lecture du message avant de trancher.
 */
export function classifyCredentialProbe(outcome: CredentialProbeOutcome): CredentialVerdict {
  const { status } = outcome;
  const detail = (outcome.detail ?? '').toLowerCase();
  if (status === undefined) return 'unreachable';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'rejected';
  if (status === 402) return 'no-credit';
  if (NO_CREDIT.some((marker) => detail.includes(marker))) return 'no-credit';
  if (status === 403) return 'rejected';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'unreachable';
  return 'unknown';
}

/** Un verdict qui demande une action humaine (les autres se rejouent ou ne disent rien). */
export function needsAttention(verdict: CredentialVerdict): boolean {
  return verdict === 'rejected' || verdict === 'no-credit';
}

/**
 * Fréquences du test automatique, réglables dans Paramètres → Modules. Trois
 * rythmes parce que trois coûts : l'accès est gratuit chez la plupart des
 * fournisseurs, payant (un appel d'un jeton) chez ceux qui n'ont pas de listing,
 * et le crédit génère toujours un appel.
 */
export interface CredentialCheckSchedule {
  /** Test d'accès gratuit. */
  accessEveryHours: number;
  /** Test d'accès chez un fournisseur sans listing gratuit (Perplexity) : c'est un appel payant. */
  paidAccessEveryHours: number;
  /** Test de crédit. */
  creditEveryHours: number;
}

export const DEFAULT_CREDENTIAL_SCHEDULE: CredentialCheckSchedule = {
  accessEveryHours: 24,
  paidAccessEveryHours: 168,
  creditEveryHours: 168,
};

/** Ce que l'on sait du dernier passage sur une credential. */
export interface CredentialCheckHistory {
  /** Dernier test qui a vérifié l'ACCÈS — un test de crédit en est un aussi. */
  lastAccessAt?: Date | null;
  lastCreditAt?: Date | null;
}

const HOUR_MS = 3_600_000;

function elapsed(since: Date | null | undefined, everyHours: number, now: Date): boolean {
  return !since || now.getTime() - since.getTime() >= everyHours * HOUR_MS;
}

/**
 * Quel test jouer maintenant sur cette credential, s'il y en a un. Le crédit prime : il
 * prouve l'accès, jouer les deux dans le même passage doublerait l'appel payant. Une
 * credential jamais testée est due tout de suite.
 */
export function credentialCheckDue(
  spec: CredentialCheckSpec,
  history: CredentialCheckHistory,
  schedule: CredentialCheckSchedule,
  now = new Date(),
): CredentialCheckLevel | null {
  if (hasQuotaCheck(spec) && elapsed(history.lastCreditAt, schedule.creditEveryHours, now)) return 'quota';
  const accessEvery = hasQuotaCheck(spec) ? schedule.accessEveryHours : schedule.paidAccessEveryHours;
  // Sans listing gratuit, l'accès EST l'appel de crédit : un seul rythme les gouverne.
  if (!hasQuotaCheck(spec)) {
    return elapsed(history.lastAccessAt, Math.min(accessEvery, schedule.creditEveryHours), now)
      ? 'quota'
      : null;
  }
  return elapsed(history.lastAccessAt, accessEvery, now) ? 'auth' : null;
}

export type CredentialAlertDecision = 'alert' | 'clear' | 'none';

/**
 * Faut-il alerter après ce verdict ? Une alerte par PANNE, jamais une par passage : un
 * verdict qui demande une action n'alerte que s'il diffère de celui déjà annoncé.
 * Et on ne lève que ce que le test a réellement prouvé : un accès accepté ne dit rien
 * du crédit, donc un « plus de crédit » annoncé ne tombe qu'au test de crédit.
 */
export function credentialAlertDecision(
  alerted: CredentialVerdict | null,
  verdict: CredentialVerdict,
  level: CredentialCheckLevel,
): CredentialAlertDecision {
  if (needsAttention(verdict)) return alerted === verdict ? 'none' : 'alert';
  if (verdict !== 'ok' || alerted === null) return 'none';
  return level === 'quota' || alerted === 'rejected' ? 'clear' : 'none';
}
