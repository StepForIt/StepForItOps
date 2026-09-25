import { Injectable } from '@nestjs/common';
import { ModelAuditSettings } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const SINGLETON = 'default';

export interface ModelAuditSettingsInput {
  savingsThresholdPct?: number;
  minAnnualSavingsUsd?: number;
  catalogStaleDays?: number;
  minTaskConfidence?: number;
}

/** Les seuils de l'audit : ce en deçà de quoi on se tait. Ligne unique. */
@Injectable()
export class ModelAuditSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ModelAuditSettings> {
    return this.prisma.modelAuditSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON },
      update: {},
    });
  }

  async update(input: ModelAuditSettingsInput): Promise<ModelAuditSettings> {
    const data = {
      savingsThresholdPct: clamp(input.savingsThresholdPct, 0, 100),
      minAnnualSavingsUsd: clamp(input.minAnnualSavingsUsd, 0, 100_000),
      catalogStaleDays: clamp(input.catalogStaleDays, 1, 365),
      minTaskConfidence: clamp(input.minTaskConfidence, 0, 1),
    };
    return this.prisma.modelAuditSettings.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...definedOnly(data) },
      update: definedOnly(data),
    });
  }

  /**
   * Le premier remplissage du catalogue n'alerte sur rien : sans ça, la mise en
   * service du module annoncerait comme une nouvelle tout ce qui est déprécié
   * depuis deux ans. Renvoie `true` quand l'amorçage était déjà fait.
   */
  async armLifecycle(): Promise<boolean> {
    const settings = await this.get();
    if (settings.lifecycleArmed) return true;
    await this.prisma.modelAuditSettings.update({
      where: { id: SINGLETON },
      data: { lifecycleArmed: true },
    });
    return false;
  }
}

function clamp(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return undefined;
  return Math.min(max, Math.max(min, Number(value)));
}

function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
