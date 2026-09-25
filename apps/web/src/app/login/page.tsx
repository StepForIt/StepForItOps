import React from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  allowedDomains,
  appUsername,
  isAuthEnabled,
  isGoogleConfigured,
  isPasswordConfigured,
} from '../../lib/auth/auth-config';
import { SESSION_COOKIE, readSession } from '../../lib/auth/session';
import { dbAuthState } from '../../lib/auth/db-auth';
import { safeNextPath } from '../../lib/auth/safe-redirect';
import { LoginCard } from './login-card';

export const dynamic = 'force-dynamic';

/**
 * Page de connexion. Server component : les méthodes proposées dépendent de la
 * configuration (variables d'environnement), qui ne doit pas partir au navigateur.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const next = safeNextPath(searchParams.next);
  const db = await dbAuthState();

  // Déjà connecté (ou plateforme ouverte) : rien à faire ici.
  if (!isAuthEnabled() && !db?.configured) redirect(next);
  if (await readSession(cookies().get(SESSION_COOKIE)?.value, db?.sessionSecret ?? undefined)) {
    redirect(next);
  }

  return (
    <LoginCard
      googleEnabled={isGoogleConfigured()}
      passwordEnabled={isPasswordConfigured() || Boolean(db?.configured)}
      domains={allowedDomains()}
      username={isPasswordConfigured() ? appUsername() : (db?.username ?? appUsername())}
      next={next}
      error={searchParams.error}
    />
  );
}
