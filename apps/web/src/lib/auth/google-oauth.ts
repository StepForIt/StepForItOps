/**
 * Google OAuth « à la main », restreint aux domaines Workspace de l'équipe.
 *
 * Flux : /auth/google → Google → /auth/google/callback.
 *
 * L'ID token est récupéré en DIRECT depuis l'endpoint token de Google, en TLS
 * serveur-à-serveur : Google documente qu'on peut alors se fier à son contenu
 * sans revérifier la signature cryptographique. On valide tout de même les
 * claims sensibles : aud, iss, exp, email_verified, et surtout le domaine.
 *
 */

import { allowedDomains } from './auth-config';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_SCOPES = 'openid email profile';

/**
 * Base URL publique de l'app. Indispensable derrière un reverse proxy :
 * `req.url` porte l'adresse interne du conteneur, inutilisable comme
 * `redirect_uri` OAuth.
 */
export function appBaseUrl(req: Request): string {
  const fromEnv = process.env.APP_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const headers = req.headers;
  const proto = headers.get('x-forwarded-proto') || 'http';
  const host = headers.get('x-forwarded-host') || headers.get('host') || '';
  return `${proto}://${host}`;
}

/** URL absolue (host public) vers un chemin de l'app — pour NextResponse.redirect. */
export function publicUrl(req: Request, path: string): URL {
  return new URL(path, appBaseUrl(req));
}

function redirectUri(req: Request): string {
  return `${appBaseUrl(req)}/auth/google/callback`;
}

/** URL d'autorisation Google. `state` protège du CSRF (vérifié au retour). */
export function buildAuthUrl(req: Request, state: string): string {
  const domains = allowedDomains();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: IDENTITY_SCOPES,
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  // Indice UI (pré-filtre les comptes proposés) — NON contraignant, le contrôle
  // réel est fait au retour sur les claims. Sans objet si plusieurs domaines.
  if (domains.length === 1) params.set('hd', domains[0]);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleIdentity {
  email: string;
  name: string;
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const part = idToken.split('.')[1];
  if (!part) throw new Error('malformed_id_token');
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/**
 * Échange le `code` contre l'ID token, valide ses claims et le domaine.
 * Lève une Error dont le message est un motif court (`wrong_domain`,
 * `email_unverified`, `token_exchange`…) destiné à la page de login.
 */
export async function exchangeAndVerify(req: Request, code: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('token_exchange');

  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('no_id_token');

  const claims = decodeJwtPayload(data.id_token);

  // Intégrité du jeton : destiné à NOTRE client, émis par Google, non expiré.
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('bad_aud');
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') {
    throw new Error('bad_iss');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) throw new Error('expired');

  // Contrôle d'accès réel : email vérifié + domaine de l'équipe.
  const email = String(claims.email || '').toLowerCase();
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) throw new Error('email_unverified');

  const domains = allowedDomains();
  const hd = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '';
  // `hd` (Google Workspace) ET le suffixe de l'email : un compte Gmail perso qui
  // porterait une adresse du domaine autorisé n'a pas de `hd`, donc il est refusé.
  if (!domains.includes(hd)) throw new Error('wrong_domain');
  if (!domains.some((domain) => email.endsWith(`@${domain}`))) throw new Error('wrong_domain');

  return {
    email,
    name: String(claims.name || claims.given_name || email.split('@')[0]),
  };
}
