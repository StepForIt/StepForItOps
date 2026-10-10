import { Injectable } from '@nestjs/common';
import { CredentialCheckSettings } from '@prisma/client';
import { CredentialCheckSchedule } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

const SINGLETON = 'default';

export interface CredentialCheckSettingsInput {
  enabled?: boolean;
  accessEveryHours?: number;
  paidAccessEveryHours?: number;
  creditEveryHours?: number;
}

/**
 * Les fréquences du test automatique. Ligne unique, bornées côté API : une valeur à 0 ferait
 * jouer un appel payant à chaque passage du cron, et c'est l'écran qui la saisit.
 */
@Injectable()
export class CredentialCheckSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(): Promise<CredentialCheckSettings> {
    return this.prisma.credentialCheckSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON },
      update: {},
    });
  }

  async update(input: CredentialCheckSettingsInput): Promise<CredentialCheckSettings> {
    const data = definedOnly({
      enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
      accessEveryHours: clampHours(input.accessEveryHours, 1, 24 * 30),
      paidAccessEveryHours: clampHours(input.paidAccessEveryHours, 1, 24 * 90),
      creditEveryHours: clampHours(input.creditEveryHours, 1, 24 * 90),
    });
    return this.prisma.credentialCheckSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...data },
      update: data,
    });
  }

  schedule(settings: CredentialCheckSettings): CredentialCheckSchedule {
    return {
      accessEveryHours: settings.accessEveryHours,
      paidAccessEveryHours: settings.paidAccessEveryHours,
      creditEveryHours: settings.creditEveryHours,
    };
  }
}

function clampHours(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return undefined;
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}

function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
