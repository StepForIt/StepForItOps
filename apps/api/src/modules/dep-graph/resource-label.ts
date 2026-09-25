import { ResourceRef } from '@nwm/core';

export const PROVIDER_LABELS: Record<string, string> = {
  airtable: 'Airtable',
  'google-sheets': 'Google Sheets',
  notion: 'Notion',
  nocodb: 'NocoDB',
  postgres: 'PostgreSQL',
  http: 'API',
};

/**
 * Label lisible d'une ressource : nom découvert auprès du provider s'il existe,
 * sinon le nom mis en cache par n8n ("Google Sheets · Tableau de bord"), sinon
 * les ids bruts ("NocoDB · p8r3…/m2py…").
 *
 * `discovered` vient du cache `ResourceLabel`, rempli par `resource-discovery` :
 * c'est la seule source pour NocoDB, dont le JSON n8n ne porte que des ids.
 */
export function friendlyLabel(
  ref: Pick<ResourceRef, 'provider' | 'key' | 'label'>,
  discovered?: string,
): string {
  const provider = PROVIDER_LABELS[ref.provider] ?? ref.provider;
  const name = discovered ?? ref.label;
  if (name) return `${provider} · ${name}`;
  const detail = ref.key.slice(ref.key.indexOf(':') + 1);
  return `${provider} · ${detail}`;
}
