import { NextResponse } from 'next/server';
import { publicUrl } from '../../../lib/auth/google-oauth';
import { checkCredentials } from '../../../lib/auth/password-login';
import { dbAuthState, verifyDbCredentials } from '../../../lib/auth/db-auth';
import { safeNextPath } from '../../../lib/auth/safe-redirect';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../../../lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Connexion par identifiant / mot de passe (formulaire de /login) : le compte
 * d'équipe des variables d'environnement, sinon celui créé au premier setup.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');
  const next = safeNextPath(String(form.get('next') ?? ''));

  const ok = checkCredentials(username, password) || (await verifyDbCredentials(username, password));
  if (!ok) {
    const back = publicUrl(req, `/login?error=credentials&next=${encodeURIComponent(next)}`);
    // 303 : le POST du formulaire devient un GET sur /login.
    return NextResponse.redirect(back, 303);
  }

  const db = await dbAuthState();
  const target = publicUrl(req, next);
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(
    SESSION_COOKIE,
    await signSession({ email: username, name: username, via: 'password' }, db?.sessionSecret ?? undefined),
    sessionCookieOptions(target.protocol === 'https:'),
  );
  return response;
}
