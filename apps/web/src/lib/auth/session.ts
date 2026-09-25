/**
 * Session applicative : un cookie signé qui porte l'identité connectée.
 *
 * Le cookie ne contient pas de référence à une ligne en base (la plateforme n'a
 * pas de table utilisateur) mais l'identité elle-même, signée. L'expiration est
 * DANS le payload signé : le `maxAge` du cookie est côté client, donc
 * falsifiable, la date signée ne l'est pas.
 */

import { signValue, verifyValue } from './cookie-signing';
import { sessionSecret } from './auth-config';

export const SESSION_COOKIE = 'nwm_session';

/** Durée de vie d'une session (7 jours) — au-delà, reconnexion. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  email: string;
  name: string;
  /** Méthode de connexion, affichée dans le menu (Google ou mot de passe). */
  via: 'google' | 'password';
}

interface SessionPayload extends SessionUser {
  /** Expiration (ms epoch), signée avec le reste. */
  exp: number;
}

/**
 * Valeur à poser dans le cookie de session. `secretOverride` : le secret généré
 * au premier login (stocké en DB) quand aucun secret d'environnement n'existe.
 */
export async function signSession(user: SessionUser, secretOverride?: string): Promise<string> {
  // SESSION_SECRET explicite d'abord, puis le secret généré en DB (haute entropie),
  // et seulement à défaut les dérivations d'environnement (secret OAuth, mot de passe).
  const secret = process.env.SESSION_SECRET || secretOverride || sessionSecret();
  if (!secret) throw new Error('Secret de session absent (SESSION_SECRET ou APP_PASSWORD requis).');
  const payload: SessionPayload = { ...user, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 };
  return signValue(JSON.stringify(payload), secret);
}

/** Vérifie la valeur d'un cookie de session → identité, ou `null` si invalide/expirée. */
export async function readSession(
  raw: string | undefined,
  secretOverride?: string,
): Promise<SessionUser | null> {
  if (!raw) return null;
  const secret = process.env.SESSION_SECRET || secretOverride || sessionSecret();
  if (!secret) return null; // fail closed
  const decoded = await verifyValue(raw, secret);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (!payload.email) return null;
    return { email: payload.email, name: payload.name, via: payload.via };
  } catch {
    return null;
  }
}

/** Options du cookie de session. `secure` seulement en HTTPS (sinon inutilisable en local). */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
