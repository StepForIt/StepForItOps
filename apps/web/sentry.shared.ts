/**
 * Réglages communs aux trois runtimes de Next (navigateur, serveur, edge).
 *
 * Compatible Sentry ET GlitchTip : ce dernier ne stocke ni transactions de
 * performance ni rejeu de session, d'où les échantillonnages à zéro par défaut
 * (cf. docs/sentry.md).
 */
export function sentryOptions(dsn: string | undefined) {
  const rate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0,
    // Ni corps de requête, ni cookie de session, ni adresse IP.
    sendDefaultPii: false,
  };
}

/**
 * Le DSN du front est PUBLIC (il part dans le bundle) : c'est prévu par le
 * protocole — il n'autorise que l'envoi d'événements, jamais la lecture.
 */
export const webDsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
