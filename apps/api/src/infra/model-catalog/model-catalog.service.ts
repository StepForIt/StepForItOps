import { BadRequestException, Injectable } from '@nestjs/common';
import { ModelCatalog } from '@prisma/client';
import {
  defaultTaskProfiles,
  LlmTokenUsage,
  ModelCatalogEntry,
  ModelTier,
  asModelStatus,
  asTier,
  computeCostUsd,
  matchModelPrice,
  msg,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { MODEL_CATALOG_SEED } from './model-catalog.seed';

export interface ModelCatalogInput {
  pattern: string;
  provider?: string;
  inputPerMTok: number;
  outputPerMTok: number;
  status?: string;
  retiresAt?: string | null;
  replacedByPattern?: string | null;
  tier?: string;
  supportsVision?: boolean | null;
  supportsTools?: boolean | null;
  supportsStructuredOutput?: boolean | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  weakAtTasks?: string[];
}

/**
 * Le catalogue des modèles : tarifs, cycle de vie, aptitudes.
 *
 * Il vit dans `infra/` et non dans un module métier — le catalogue de nœuds a
 * déjà tranché la question : une donnée de référence partagée par plusieurs
 * modules ne s'éteint pas avec l'un d'eux. Sans ça, éditer un tarif deviendrait
 * impossible quand `ai-cost` est coupé alors que `model-audit` tourne.
 */
@Injectable()
export class ModelCatalogService {
  private seeded = false;

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ModelCatalog[]> {
    await this.ensureSeeded();
    return this.prisma.modelCatalog.findMany({ orderBy: [{ provider: 'asc' }, { pattern: 'asc' }] });
  }

  /** Le catalogue sous la forme que les règles pures attendent. */
  async entries(): Promise<ModelCatalogEntry[]> {
    return (await this.list()).map(toEntry);
  }

  async create(input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.prisma.modelCatalog.create({ data: { ...validate(input), source: 'custom' } });
  }

  async update(id: string, input: ModelCatalogInput): Promise<ModelCatalog> {
    return this.prisma.modelCatalog.update({
      where: { id },
      data: { ...validate(input), source: 'custom', checkedAt: new Date() },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.modelCatalog.delete({ where: { id } });
  }

  /** Insère les lignes du seed manquantes — ne touche jamais une ligne existante. */
  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    await this.prisma.modelCatalog.createMany({
      data: MODEL_CATALOG_SEED.map((entry) => ({
        pattern: entry.pattern,
        provider: entry.provider,
        inputPerMTok: entry.inputPerMTok,
        outputPerMTok: entry.outputPerMTok,
        status: entry.status,
        tier: entry.tier,
        supportsVision: entry.supportsVision ?? null,
        supportsTools: entry.supportsTools ?? null,
        supportsStructuredOutput: entry.supportsStructuredOutput ?? null,
        contextWindow: entry.contextWindow ?? null,
        replacedByPattern: entry.replacedByPattern ?? null,
        source: 'seed',
      })),
      skipDuplicates: true,
    });
    await this.prisma.modelTaskProfile.createMany({
      data: defaultTaskProfiles().map((profile) => ({
        task: profile.task,
        minTier: profile.minTier,
        rationale: profile.rationale,
        source: 'seed',
      })),
      skipDuplicates: true,
    });
    this.seeded = true;
  }

  /** Planchers par tâche, tels que les règles les attendent. */
  async taskProfiles(): Promise<Record<string, ModelTier>> {
    await this.ensureSeeded();
    const rows = await this.prisma.modelTaskProfile.findMany();
    return Object.fromEntries(rows.map((row) => [row.task, asTier(row.minTier)]));
  }

  async setTaskProfile(task: string, minTier: string, rationale?: string): Promise<void> {
    await this.prisma.modelTaskProfile.upsert({
      where: { task },
      create: { task, minTier: asTier(minTier), rationale, source: 'custom' },
      update: { minTier: asTier(minTier), rationale, source: 'custom' },
    });
  }

  /**
   * Le catalogue a-t-il été confronté à une source récemment ? Au-delà, tout ce
   * qui dépend de la fraîcheur se tait : un catalogue périmé qui se tait vaut
   * mieux qu'un catalogue périmé qui affirme.
   */
  async freshness(): Promise<{ checkedAt: Date | null; ageDays: number | null }> {
    const newest = await this.prisma.modelCatalog.findFirst({
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true },
    });
    if (!newest) return { checkedAt: null, ageDays: null };
    const ageDays = Math.floor((Date.now() - newest.checkedAt.getTime()) / 86_400_000);
    return { checkedAt: newest.checkedAt, ageDays };
  }

  /** Fonction de valorisation avec la table chargée une fois (pour une passe d'ingestion). */
  async pricer(): Promise<(model: string | null, usage: LlmTokenUsage) => number | null> {
    await this.ensureSeeded();
    const entries = await this.prisma.modelCatalog.findMany();
    return (model, usage) => {
      const price = matchModelPrice(model, entries);
      return price ? computeCostUsd(usage, price) : null;
    };
  }
}

export function toEntry(row: ModelCatalog): ModelCatalogEntry {
  return {
    pattern: row.pattern,
    provider: row.provider,
    inputPerMTok: row.inputPerMTok,
    outputPerMTok: row.outputPerMTok,
    status: asModelStatus(row.status),
    tier: asTier(row.tier),
    retiresAt: row.retiresAt?.toISOString() ?? null,
    replacedByPattern: row.replacedByPattern,
    supportsVision: row.supportsVision,
    supportsTools: row.supportsTools,
    supportsStructuredOutput: row.supportsStructuredOutput,
    contextWindow: row.contextWindow,
    weakAtTasks: row.weakAtTasks,
  };
}

function validate(input: ModelCatalogInput) {
  const pattern = (input.pattern ?? '').trim();
  const inputPerMTok = Number(input.inputPerMTok);
  const outputPerMTok = Number(input.outputPerMTok);
  if (!pattern) throw new BadRequestException(msg('analysis.modelPatternRequired'));
  if (
    !Number.isFinite(inputPerMTok) ||
    inputPerMTok < 0 ||
    !Number.isFinite(outputPerMTok) ||
    outputPerMTok < 0
  ) {
    throw new BadRequestException(msg('analysis.modelPricesInvalid'));
  }
  return {
    pattern,
    provider: (input.provider ?? 'other').trim() || 'other',
    inputPerMTok,
    outputPerMTok,
    status: asModelStatus(input.status),
    tier: asTier(input.tier),
    retiresAt: input.retiresAt ? new Date(input.retiresAt) : null,
    replacedByPattern: input.replacedByPattern?.trim() || null,
    supportsVision: input.supportsVision ?? null,
    supportsTools: input.supportsTools ?? null,
    supportsStructuredOutput: input.supportsStructuredOutput ?? null,
    contextWindow: input.contextWindow ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    weakAtTasks: input.weakAtTasks ?? [],
  };
}
