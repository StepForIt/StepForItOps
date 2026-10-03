import { NextResponse } from 'next/server';
import { isAuthEnabled } from '../../../lib/auth/auth-config';
import { apiBase, dbAuthState } from '../../../lib/auth/db-auth';

/**
 * État de la configuration de sécurité, lu côté serveur Next (seul à voir les
 * variables d'environnement). Ne renvoie que des drapeaux — jamais de valeur.
 * Consommé par la bannière d'avertissement de la console (SecurityWarnings).
 */

export const dynamic = 'force-dynamic';

export type SecurityWarningCode = 'auth-open' | 'api-open' | 'no-session-secret' | 'secrets-plain';

/**
 * `SECRETS_KEY` est une variable de l'API, que Next ne voit pas : on le lui
 * demande. API muette ⇒ null, et rien n'est affirmé.
 */
async function secretsEncrypted(): Promise<boolean | null> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.API_ACCESS_TOKEN) headers['x-api-token'] = process.env.API_ACCESS_TOKEN;
    const response = await fetch(`${apiBase()}/security/status`, { headers, cache: 'no-store' });
    if (!response.ok) return null;
    return ((await response.json()) as { secretsEncrypted: boolean }).secretsEncrypted;
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const db = await dbAuthState();
  const authEnabled = isAuthEnabled() || Boolean(db?.configured);
  const warnings: SecurityWarningCode[] = [];
  // Plateforme réellement ouverte = AUTH_OPTIONAL en dev : hors de ce mode,
  // le middleware force /setup avant tout.
  if (!authEnabled) warnings.push('auth-open');
  if (!process.env.API_ACCESS_TOKEN) warnings.push('api-open');
  // Le secret généré au setup (haute entropie, en DB) vaut un SESSION_SECRET.
  if (authEnabled && !process.env.SESSION_SECRET && !db?.sessionSecret) {
    warnings.push('no-session-secret');
  }
  if ((await secretsEncrypted()) === false) warnings.push('secrets-plain');
  return NextResponse.json({ warnings });
}
