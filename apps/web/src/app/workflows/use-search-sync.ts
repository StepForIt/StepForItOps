'use client';

import React from 'react';
import { apiPost } from '../../lib/api';
import { claimSearchSync } from '../../lib/workflow-search';

/**
 * Recherche restée sans résultat ⇒ UNE synchro depuis n8n, puis un seul rechargement
 * de la liste. Le miroir local ne bouge qu'à l'heure (cron) : un workflow créé dans
 * n8n ce matin n'y est pas encore, et la liste vide se lit comme « il n'existe pas ».
 *
 * Garde-fous dans `claimSearchSync` (longueur minimale, terme déjà tenté ou
 * prolongé) et ici : rien tant que la requête de liste n'est pas retombée, sinon
 * « vide » ne veut rien dire. Le délai de garde par instance, lui, est tenu par
 * l'API : c'est le seul endroit qui voit tous les onglets.
 */
export function useSearchSync({
  term,
  instanceId,
  empty,
  ready,
  reload,
}: {
  term?: string;
  instanceId: string | null;
  /** La liste est revenue vide pour ce terme. */
  empty: boolean;
  /** La requête de liste est retombée : avant, « vide » ne veut rien dire. */
  ready: boolean;
  reload: () => void;
}): boolean {
  const attempted = React.useRef(new Set<string>());
  const [syncing, setSyncing] = React.useState(false);
  const search = (term ?? '').trim();

  React.useEffect(() => {
    if (!ready || !empty) return undefined;
    if (!claimSearchSync(search, instanceId, attempted.current)) return undefined;

    let cancelled = false;
    setSyncing(true);
    apiPost('/workflows/search-sync', { instanceId: instanceId ?? undefined })
      .then(() => {
        if (!cancelled) reload();
      })
      // Instance injoignable : la liste reste sur le miroir local, sans message d'erreur
      // pour une synchro que l'utilisateur n'a pas demandée.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, instanceId, empty, ready, reload]);

  return syncing;
}
