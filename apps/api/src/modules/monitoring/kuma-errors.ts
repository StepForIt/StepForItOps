import { BadGatewayException } from '@nestjs/common';

/** Colonne SQLite manquante dans le payload envoyé à Kuma (schéma qui a bougé entre versions). */
const MISSING_COLUMN = /NOT NULL constraint failed: monitor\.(\w+)/;
const MAX_DETAIL = 300;

/**
 * Un échec côté Uptime Kuma n'est pas un plantage de la plateforme : c'est un
 * système tiers qui refuse. On rend 502 avec un message lisible plutôt qu'un 500
 * exposant la requête SQL brute de Kuma.
 */
export function kumaFailure(action: string, error: unknown): BadGatewayException {
  const detail = error instanceof Error ? error.message : String(error);
  const missing = MISSING_COLUMN.exec(detail)?.[1];
  const hint = missing
    ? ` — la colonne « ${missing} » est obligatoire dans cette version de Kuma et n'est pas envoyée : ` +
      'compléter le payload de `KumaAdminAdapter.createPushProbe`.'
    : '';
  return new BadGatewayException(`Uptime Kuma — ${action} : ${detail.slice(0, MAX_DETAIL)}${hint}`);
}

/** Exécute un appel au port Kuma en traduisant toute erreur en 502 lisible. */
export async function callKuma<T>(action: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw kumaFailure(action, error);
  }
}
