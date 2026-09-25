import { redirect } from 'next/navigation';

/**
 * Tables externes est devenue Ressources externes : redirection qui garde la clé et la
 * colonne de l'URL, pour que les favoris continuent de marcher.
 */
export default async function TablesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(name, value);
  }
  const query = params.toString();
  redirect(query ? `/resources?${query}` : '/resources');
}
