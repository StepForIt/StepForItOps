import * as Sentry from '@sentry/nextjs';

/** Point d'entrée de Next : un fichier de config par runtime. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

// Erreurs levées pendant le rendu serveur d'une page (Next 15+ l'appelle seul ;
// inerte ailleurs).
export const onRequestError = Sentry.captureRequestError;
