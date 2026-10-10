import { BadRequestException } from '@nestjs/common';
import { msg } from '@nwm/core';

/** Providers que la bascule sait lire et réécrire ; le formulaire propose la même liste. */
export const MAPPING_PROVIDERS = [
  'airtable',
  'google-sheets',
  'notion',
  'nocodb',
  'postgres',
  'credential',
] as const;

export interface ResourceMappingInput {
  provider?: string;
  logicalName?: string;
  values?: unknown;
  labels?: unknown;
}

function isEnvMap(value: unknown): value is Record<string, Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (rows) =>
      typeof rows === 'object' &&
      rows !== null &&
      !Array.isArray(rows) &&
      Object.values(rows).every((entry) => typeof entry === 'string'),
  );
}

function hasIdentifier(values: Record<string, Record<string, string>>): boolean {
  return Object.values(values).some((rows) => Object.values(rows).some((entry) => entry.trim() !== ''));
}

/**
 * Ce que la console envoyait déjà, désormais vérifié : un corps passé tel quel à Prisma
 * enregistrait n'importe quoi (provider inventé, ids imbriqués, mapping vide) et la
 * promotion ne s'en apercevait qu'en réécrivant un workflow. `partial` pour un PATCH,
 * où seuls les champs présents sont jugés.
 */
export function assertValidMapping(input: ResourceMappingInput, partial: boolean): void {
  if (!partial || input.provider !== undefined) {
    if (!MAPPING_PROVIDERS.includes(input.provider as (typeof MAPPING_PROVIDERS)[number])) {
      throw new BadRequestException(
        msg('env.mappingProvider', {
          provider: String(input.provider ?? ''),
          allowed: MAPPING_PROVIDERS.join(', '),
        }),
      );
    }
  }
  if (!partial || input.logicalName !== undefined) {
    if (typeof input.logicalName !== 'string' || input.logicalName.trim() === '') {
      throw new BadRequestException(msg('env.mappingName'));
    }
  }
  if (!partial || input.values !== undefined) {
    if (!isEnvMap(input.values)) throw new BadRequestException(msg('env.mappingShape', { field: 'values' }));
    if (!hasIdentifier(input.values)) throw new BadRequestException(msg('env.mappingValues'));
  }
  if (input.labels !== undefined && input.labels !== null && !isEnvMap(input.labels)) {
    throw new BadRequestException(msg('env.mappingShape', { field: 'labels' }));
  }
}
