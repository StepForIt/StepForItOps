import { AsyncLocalStorage } from 'node:async_hooks';
import { LockOverride } from '@nwm/core';

/**
 * Ce que la requête en cours dit du verrou : le forçage demandé, qui le demande,
 * et le geste (route) qui écrit. Porté par la requête plutôt que par chaque
 * signature de service : une vingtaine de gestes écrivent, et le garde doit
 * pouvoir le lire au plus près de l'écriture, là où la route n'est plus visible.
 *
 * Hors requête HTTP (cron, événement), il n'y a pas de contexte : rien n'est levé,
 * et un exemplaire verrouillé refuse l'écriture.
 */
export interface LockContext {
  override: LockOverride | null;
  author?: string;
  action: string;
  /** Verrous déjà levés et journalisés par CETTE requête : une ligne de journal par geste, pas par écriture. */
  journaled?: Set<string>;
}

const storage = new AsyncLocalStorage<LockContext>();

export function currentLockContext(): LockContext | undefined {
  return storage.getStore();
}

export function runWithLockContext<T>(context: LockContext, fn: () => T): T {
  return storage.run(context, fn);
}
