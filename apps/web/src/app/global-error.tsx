'use client';

import React from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Dernier filet du front : une erreur de rendu qui remonte jusqu'ici a emporté
 * la mise en page entière (Refine et antd compris), d'où le HTML nu.
 *
 * C'est le seul endroit où une erreur du navigateur est capturée : le reste du
 * temps, ce qui casse est un appel à l'API, et l'API le remonte de son côté.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <h1 style={{ fontSize: 20 }}>La console a rencontré une erreur</h1>
        <p style={{ color: '#666' }}>
          {error.message}
          {error.digest ? ` (${error.digest})` : ''}
        </p>
        <button type="button" onClick={reset} style={{ padding: '6px 14px', cursor: 'pointer' }}>
          Réessayer
        </button>
      </body>
    </html>
  );
}
