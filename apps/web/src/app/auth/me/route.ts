import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAuthEnabled } from '../../../lib/auth/auth-config';
import { dbAuthState } from '../../../lib/auth/db-auth';
import { SESSION_COOKIE, readSession } from '../../../lib/auth/session';

export const dynamic = 'force-dynamic';

/** Identité connectée, pour l'affichage du menu utilisateur. */
export async function GET(): Promise<NextResponse> {
  const db = await dbAuthState();
  if (!isAuthEnabled() && !db?.configured) return NextResponse.json({ authEnabled: false, user: null });
  const user = await readSession(cookies().get(SESSION_COOKIE)?.value, db?.sessionSecret ?? undefined);
  return NextResponse.json({ authEnabled: true, user });
}
