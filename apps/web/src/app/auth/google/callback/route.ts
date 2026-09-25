import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isGoogleConfigured, sessionSecret } from '../../../../lib/auth/auth-config';
import { verifyValue } from '../../../../lib/auth/cookie-signing';
import { exchangeAndVerify, publicUrl } from '../../../../lib/auth/google-oauth';
import { safeNextPath } from '../../../../lib/auth/safe-redirect';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../../../../lib/auth/session';
import { dbAuthState } from '../../../../lib/auth/db-auth';

export const dynamic = 'force-dynamic';

/** Retour de Google : vérifie le state, valide le domaine, ouvre la session. */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isGoogleConfigured()) return NextResponse.redirect(publicUrl(req, '/login?error=google_off'));

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const cookieStore = cookies();
  const signedState = cookieStore.get('nwm_oauth_state')?.value;
  cookieStore.delete('nwm_oauth_state');

  // Anti-CSRF : le state renvoyé par Google doit correspondre au cookie signé.
  const expected = signedState ? await verifyValue(signedState, sessionSecret()) : null;
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(publicUrl(req, '/login?error=oauth'));
  }

  let identity;
  try {
    identity = await exchangeAndVerify(req, code);
  } catch (error) {
    const reason = (error as Error)?.message === 'wrong_domain' ? 'domain' : 'oauth';
    return NextResponse.redirect(publicUrl(req, `/login?error=${reason}`));
  }

  let next = '/';
  try {
    next = safeNextPath((JSON.parse(expected) as { next?: string }).next);
  } catch {
    // state illisible : on retombe sur l'accueil
  }

  const target = publicUrl(req, next);
  const response = NextResponse.redirect(target);
  response.cookies.set(
    SESSION_COOKIE,
    await signSession(
      { email: identity.email, name: identity.name, via: 'google' },
      (await dbAuthState())?.sessionSecret ?? undefined,
    ),
    sessionCookieOptions(target.protocol === 'https:'),
  );
  return response;
}
