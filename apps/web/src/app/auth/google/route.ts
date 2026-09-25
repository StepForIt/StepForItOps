import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isGoogleConfigured, sessionSecret } from '../../../lib/auth/auth-config';
import { signValue } from '../../../lib/auth/cookie-signing';
import { buildAuthUrl, publicUrl } from '../../../lib/auth/google-oauth';
import { safeNextPath } from '../../../lib/auth/safe-redirect';

export const dynamic = 'force-dynamic';

/** Démarre le login Google : pose un state signé (anti-CSRF) et redirige. */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isGoogleConfigured()) return NextResponse.redirect(publicUrl(req, '/login?error=google_off'));

  const next = safeNextPath(new URL(req.url).searchParams.get('next'));
  // Le state porte le nonce ET la destination : pas de cookie supplémentaire,
  // et la destination est signée (donc non modifiable pendant l'aller-retour).
  const state = JSON.stringify({ n: crypto.randomUUID(), next });
  const signedState = await signValue(state, sessionSecret());

  cookies().set('nwm_oauth_state', signedState, {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl(req, '/').protocol === 'https:',
    path: '/',
    maxAge: 600, // 10 min : le temps de l'écran de consentement
  });

  return NextResponse.redirect(buildAuthUrl(req, state));
}
