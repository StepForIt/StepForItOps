import React from 'react';
import { redirect } from 'next/navigation';
import { isAuthEnabled } from '../../lib/auth/auth-config';
import { dbAuthState } from '../../lib/auth/db-auth';
import { SetupCard } from './setup-card';

export const dynamic = 'force-dynamic';

/** Premier lancement : la seule page servie tant qu'aucune auth n'existe. */
export default async function SetupPage({ searchParams }: { searchParams: { error?: string } }) {
  const db = await dbAuthState();
  if (isAuthEnabled() || db?.configured) redirect('/');
  return <SetupCard error={searchParams.error} />;
}
