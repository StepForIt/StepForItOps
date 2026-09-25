import { NextResponse } from 'next/server';
import { isAuthEnabled } from '../../../lib/auth/auth-config';
import { bootstrapDbAuth, dbAuthState } from '../../../lib/auth/db-auth';
import { publicUrl } from '../../../lib/auth/google-oauth';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../../../lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Premier setup (formulaire de /setup) : crée LE compte admin puis connecte
 * directement — pas de second formulaire de login juste après.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const username = String(form.get('username') ?? '').trim() || 'admin';
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const back = (error: string) =>
    NextResponse.redirect(publicUrl(req, `/setup?error=${encodeURIComponent(error)}`), 303);

  // Déjà configurée (env ou DB) : le setup n'a plus d'objet.
  const db = await dbAuthState();
  if (isAuthEnabled() || db?.configured) return back('already');
  if (password !== confirm) return back('mismatch');

  const result = await bootstrapDbAuth(username, password);
  if (!result.ok) return back(result.error);

  const target = publicUrl(req, '/');
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(
    SESSION_COOKIE,
    await signSession(
      { email: username, name: username, via: 'password' },
      result.state.sessionSecret ?? undefined,
    ),
    sessionCookieOptions(target.protocol === 'https:'),
  );
  return response;
}
