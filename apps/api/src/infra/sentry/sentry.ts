import * as Sentry from '@sentry/node';
import { redactSecrets } from '@nwm/core';

/**
 * Remontée des erreurs de l'API vers Sentry — ou vers n'importe quel serveur qui
 * parle son protocole, GlitchTip en particulier (cf. docs/sentry.md).
 *
 * Sans `SENTRY_DSN`, rien n'est initialisé : la plateforme doit tourner
 * entière sans service externe, et un SDK initialisé à vide met en file des
 * événements que personne ne relèvera.
 *
 * Ce n'est pas un port hexagonal : Sentry ne rend aucun service au domaine, il
 * observe le process — comme le tampon de logs, il vit dans `infra/` et se
 * branche avant la DI.
 */

/** Le tampon de logs garde le détail ; ici on ne veut que ce qui a cassé. */
const DEFAULT_TRACES_SAMPLE_RATE = 0;

function sampleRate(): number {
  const raw = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_TRACES_SAMPLE_RATE;
}

export function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

export function initSentry(): void {
  if (!isSentryEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    // GlitchTip ne stocke pas les transactions de performance : les échantillonner
    // par défaut, c'est payer des appels réseau pour des données jetées.
    tracesSampleRate: sampleRate(),
    // Ni corps de requête, ni cookies, ni adresse IP : ce qui part d'ici est ce
    // qui a cassé, pas ce que l'utilisateur a envoyé.
    sendDefaultPii: false,
    beforeSend(event) {
      // Même masquage que les logs à l'écran : une clé n8n ou un jeton GitHub
      // se promène dans un message d'erreur aussi facilement que dans un log.
      return redactSecrets(event);
    },
  });
}

/**
 * Une erreur, avec la requête qui l'a produite.
 *
 * L'URL est celle du routage (`originalUrl`), jamais la query : les jetons de
 * heartbeat et les filtres de recherche y passent.
 */
export function captureHttpError(
  error: unknown,
  request: { method: string; path: string },
  status: number,
): void {
  if (!isSentryEnabled()) return;
  Sentry.withScope((scope) => {
    scope.setTransactionName(`${request.method} ${request.path}`);
    scope.setContext('http', { method: request.method, path: request.path, status });
    scope.setTag('http.status', String(status));
    Sentry.captureException(error);
  });
}

/** Vide la file avant l'arrêt : sans ça, la dernière erreur part avec le process. */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!isSentryEnabled()) return;
  await Sentry.flush(timeoutMs);
}
