import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/auth/session';

export const dynamic = 'force-dynamic';

/** Déconnexion : efface le cookie de session. POST uniquement (pas de logout par simple lien). */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
