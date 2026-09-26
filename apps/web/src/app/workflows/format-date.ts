/** Null = la plateforme n'a pas (encore) donné sa date : un tiret plutôt que le 01/01/1970. */
export function formatDate(date: string | null, locale: string): string {
  return date ? new Date(date).toLocaleString(locale) : '—';
}
