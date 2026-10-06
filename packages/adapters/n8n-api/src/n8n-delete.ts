import { N8nApiError } from '@nwm/core';

/**
 * Suppression d'un workflow qui tient compte de n8n 2.x : un workflow PUBLIÉ ne se
 * supprime pas, et juste après sa dépublication n8n répond encore « still being
 * unpublished » pendant quelques secondes. Supprimer d'un coup laissait donc dans
 * le n8n du client les workflows temporaires de la plateforme (`[NWM discovery]`,
 * sondes du schéma distant) : un refus avalé en `warn`, et un reste de plus à
 * chaque découverte. D'où : dépublier, puis rejouer la suppression tant que n8n
 * répond 409 (ou 400 qui parle de publication), dans une borne courte. Tout autre
 * refus remonte tel quel, sans attendre.
 */
export interface DeleteRetryOptions {
  /** Durée maximale des rejeux, en ms. */
  timeoutMs?: number;
  /** Pause entre deux tentatives, en ms. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const PUBLISH_WORDING = /publish|active/i;

/** Refus qui veut dire « pas encore » : la dépublication est en cours, la suppression passera. */
export function isPendingUnpublish(error: unknown): boolean {
  if (!(error instanceof N8nApiError)) return false;
  if (error.status === 409) return true;
  return error.status === 400 && PUBLISH_WORDING.test(error.message);
}

export async function deleteAfterUnpublish(
  deactivate: () => Promise<void>,
  remove: () => Promise<void>,
  options: DeleteRetryOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 700;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  try {
    await deactivate();
  } catch {
    /* déjà inactif, ou n8n sans notion de publication */
  }
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      await remove();
      return;
    } catch (error) {
      if (!isPendingUnpublish(error) || now() >= deadline) throw error;
      await sleep(intervalMs);
    }
  }
}
