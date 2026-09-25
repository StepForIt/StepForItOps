/**
 * L'export de configuration fait sortir de la plateforme, en clair et en un
 * seul GET, tout ce qu'elle détient de sensible : clés API n8n, tokens GitHub /
 * Drive, mot de passe Uptime Kuma, clé Anthropic, jetons de heartbeat.
 *
 * Il est donc **fermé par défaut** et ne s'ouvre que là où l'opérateur est
 * devant sa machine : `docker-compose.override.yml` (dev local) pose
 * `CONFIG_EXPORT_ENABLED=1`. La prod (`docker-compose.yml`) ne la pose pas —
 * sur un serveur, la route répond 403 quoi qu'il arrive.
 *
 * La variante « sans secrets » est fermée elle aussi : elle emporte quand même
 * les jetons et URLs push des monitors, et la topologie complète des instances.
 * L'import, lui, reste ouvert : il écrit, il ne fuit rien.
 */
export const CONFIG_EXPORT_ENV = 'CONFIG_EXPORT_ENABLED';

export function isConfigExportEnabled(): boolean {
  const raw = (process.env[CONFIG_EXPORT_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}
