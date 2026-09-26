import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthEnabled } from './lib/auth/auth-config';
import { dbAuthState } from './lib/auth/db-auth';
import { SESSION_COOKIE, SessionUser, readSession } from './lib/auth/session';
import { LOCALE_COOKIE, resolveLocale } from './i18n/locale';
import frApp from '../messages/fr/app.json';
import enApp from '../messages/en/app.json';

function callerLocale(req: NextRequest) {
  return resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get('accept-language'));
}

/** Message d'un 401 dans la langue de l'appelant : l'UI l'affiche tel quel. */
function unauthorized(req: NextRequest, key: keyof typeof frApp.middleware): NextResponse {
  const locale = callerLocale(req);
  const message = (locale === 'en' ? enApp : frApp).middleware[key];
  return NextResponse.json({ statusCode: 401, message }, { status: 401 });
}

/**
 * Garde d'accès unique de la plateforme.
 *
 * Elle couvre les pages ET le proxy `/backend/*` : le navigateur ne parlant
 * qu'à l'origine du front (cf. next.config.js), tout ce qui atteint l'API passe
 * d'abord ici. Une page sans session est redirigée vers /login ; un appel
 * `/backend/*` reçoit un 401 JSON (l'UI l'affiche, elle ne suit pas une
 * redirection HTML).
 *
 * Tant qu'aucune méthode de connexion n'existe (ni variables d'environnement,
 * ni compte créé via /setup), la plateforme n'affiche QUE la page /setup :
 * plus jamais ouverte par défaut. Exception : AUTH_OPTIONAL=1 (posé par
 * docker-compose.override.yml) garde le comportement ouvert du dev local.
 */

/** Chemins accessibles sans session : login, premier setup, et le flux OAuth. */
const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/auth/setup',
  '/auth/google',
  '/auth/password',
  '/auth/logout',
  '/auth/me',
];

/**
 * Fichiers de l'installation (PWA), servis sans session.
 *
 * Le navigateur va chercher le manifeste et le service worker SANS cookie :
 * derrière la garde, il recevrait la page /login en guise de manifeste et
 * l'installation échouerait — y compris pour un utilisateur connecté. Aucun de
 * ces fichiers ne porte de donnée : ce sont des ressources statiques du build.
 */
const PWA_PATHS = ['/manifest.webmanifest', '/sw.js', '/offline.html', '/icons'];

function isPublic(pathname: string): boolean {
  return [...PUBLIC_PATHS, ...PWA_PATHS].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Injecte sur les appels proxifiés le jeton d'accès API et l'identité connectée.
 *
 * Le jeton reste serveur-à-serveur : il n'est jamais exposé au navigateur, et
 * l'API refuse les appels directs sur son domaine public (hors heartbeats).
 * `x-user-email` sert à signer les actions humaines côté API (qui a marqué une
 * erreur comme traitée) : les deux en-têtes sont posés — ou effacés — ici et
 * nulle part ailleurs, sinon le navigateur pourrait se faire passer pour un autre.
 * `x-locale` porte la langue d'affichage : l'API répond dans celle-là.
 */
function forward(req: NextRequest, session?: SessionUser | null): NextResponse {
  if (!req.nextUrl.pathname.startsWith('/backend/')) return NextResponse.next();
  const token = process.env.API_ACCESS_TOKEN;
  const headers = new Headers(req.headers);
  headers.delete('x-api-token');
  headers.delete('x-user-email');
  headers.set('x-locale', callerLocale(req));
  if (token) headers.set('x-api-token', token);
  if (session?.email) headers.set('x-user-email', session.email);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const db = await dbAuthState();
  const enabled = isAuthEnabled() || Boolean(db?.configured);
  const { pathname, search } = req.nextUrl;

  if (!enabled) {
    if (process.env.AUTH_OPTIONAL === '1') return forward(req);
    // Rien de configuré : la seule destination possible est le premier setup.
    if (isPublic(pathname)) return NextResponse.next();
    if (pathname.startsWith('/backend/')) {
      return unauthorized(req, 'notConfigured');
    }
    const setupUrl = req.nextUrl.clone();
    setupUrl.pathname = '/setup';
    setupUrl.search = '';
    return NextResponse.redirect(setupUrl);
  }

  if (isPublic(pathname)) {
    // Configurée : /setup n'a plus d'objet, on n'y laisse pas traîner.
    if (pathname === '/setup') {
      const home = req.nextUrl.clone();
      home.pathname = '/';
      home.search = '';
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value, db?.sessionSecret ?? undefined);
  if (session) return forward(req, session);

  if (pathname.startsWith('/backend/')) {
    return unauthorized(req, 'sessionExpired');
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Exclut les assets statiques ; couvre toutes les pages et le proxy /backend.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
