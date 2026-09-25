import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModelCatalog } from '@prisma/client';
import {
  AI_PORT,
  AiPort,
  MODEL_PRICING_PORT,
  ModelCatalogEntry,
  ModelPricingPort,
  asModelStatus,
  asTier,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { ModelCatalogService } from './model-catalog.service';

export interface RefreshResult {
  source: string;
  skipped: boolean;
  proposed: number;
  revision?: string;
}

/** Les champs qu'un rafraîchissement a le droit de proposer. */
const REFRESHABLE = [
  'inputPerMTok',
  'outputPerMTok',
  'status',
  'retiresAt',
  'replacedByPattern',
  'tier',
  'supportsVision',
  'supportsTools',
  'supportsStructuredOutput',
  'contextWindow',
] as const;

type RefreshableField = (typeof REFRESHABLE)[number];

/**
 * Rafraîchissement du catalogue : il PROPOSE, il n'écrit jamais.
 *
 * Un tarif faux appliqué tout seul empoisonne toute la chaîne en aval — les
 * coûts figés à l'ingestion, les économies annoncées, les alertes — et rien
 * dans une ligne d'usage ne dira ensuite d'où venait le chiffre. D'où la revue :
 * `ModelCatalogProposal`, appliquée d'un clic groupé.
 *
 * Deux sources, dans cet ordre : la source DÉCLARATIVE (versionnée, rejouable),
 * puis l'IA sur ce que celle-ci ne porte pas, et sur les seuls modèles du parc —
 * décrire huit cents modèles pour en juger trente serait payer pour rien.
 */
@Injectable()
export class ModelCatalogRefreshService {
  private readonly logger = new Logger(ModelCatalogRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ModelCatalogService,
    @Inject(MODEL_PRICING_PORT) private readonly pricing: ModelPricingPort,
    @Inject(AI_PORT) private readonly ai: AiPort,
  ) {}

  /** Source déclarative. Ne télécharge rien tant que la révision amont n'a pas bougé. */
  async refreshFromSource(force = false): Promise<RefreshResult> {
    const revision = await this.pricing.revision();
    const last = await this.prisma.modelCatalogSync.findFirst({
      where: { source: 'litellm', error: null },
      orderBy: { at: 'desc' },
    });
    if (!force && last?.revision === revision) {
      // Rien de neuf en amont : on ESTAMPILLE quand même les lignes confrontées,
      // sinon « toujours actif » et « personne n'a regardé » se ressemblent.
      await this.touchAll();
      await this.prisma.modelCatalogSync.create({ data: { source: 'litellm', revision, proposed: 0 } });
      return { source: 'litellm', skipped: true, proposed: 0, revision };
    }

    try {
      const upstream = await this.pricing.fetchModels();
      const known = await this.prisma.modelCatalog.findMany();
      const byPattern = new Map(known.map((row) => [row.pattern.toLowerCase(), row]));
      let proposed = 0;
      for (const entry of upstream) {
        const row = byPattern.get(entry.pattern.toLowerCase());
        if (!row) continue; // On ne propose PAS d'ajouter huit cents modèles inconnus du parc.
        proposed += await this.proposeDiff(row, entry, 'litellm', `révision ${revision.slice(0, 7)}`);
      }
      await this.touchAll();
      await this.prisma.modelCatalogSync.create({ data: { source: 'litellm', revision, proposed } });
      return { source: 'litellm', skipped: false, proposed, revision };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.modelCatalogSync.create({ data: { source: 'litellm', revision, error: message } });
      throw error;
    }
  }

  /**
   * Complément IA, sur les seuls modèles PRÉSENTS DANS LE PARC : statut annoncé,
   * successeur, niveau — ce que la source déclarative ne porte pas.
   */
  async refreshFromAi(): Promise<RefreshResult> {
    if (!(await this.ai.isConfigured())) return { source: 'ai', skipped: true, proposed: 0 };
    const used = await this.prisma.llmUsage.findMany({
      where: { model: { not: null } },
      distinct: ['model'],
      select: { model: true },
      take: 200,
    });
    const patterns = new Set(used.map((row) => row.model!.toLowerCase()));
    const rows = (await this.prisma.modelCatalog.findMany()).filter((row) =>
      [...patterns].some((model) => model.startsWith(row.pattern.toLowerCase())),
    );
    if (rows.length === 0) return { source: 'ai', skipped: true, proposed: 0 };

    try {
      const answer = await this.ai.generate({
        effort: 'low',
        maxTokens: 4000,
        system:
          "Tu renseignes un catalogue de modèles LLM. Tu réponds UNIQUEMENT ce dont tu es sûr : un champ que tu ignores vaut null, jamais une valeur plausible. Un tarif n'est JAMAIS demandé ici.",
        prompt: [
          'Pour chacun de ces modèles, donne son statut chez son provider, la date de retrait annoncée si elle existe, le modèle qui le remplace, et son niveau.',
          'niveau : "light" (petit modèle rapide), "standard" (modèle généraliste), "reasoning" (modèle de raisonnement).',
          'statut : "active", "preview", "deprecated" ou "retired".',
          '',
          JSON.stringify(rows.map((row) => ({ pattern: row.pattern, provider: row.provider }))),
          '',
          'Réponds en JSON : {"models":[{"pattern":"…","status":"…"|null,"retiresAt":"YYYY-MM-DD"|null,"replacedByPattern":"…"|null,"tier":"…"|null}]}',
        ].join('\n'),
      });
      const parsed = parseModels(answer);
      let proposed = 0;
      for (const item of parsed) {
        const row = rows.find((candidate) => candidate.pattern.toLowerCase() === item.pattern?.toLowerCase());
        if (!row) continue;
        proposed += await this.proposeDiff(row, sparseEntry(row, item), 'ai', 'complément du modèle actif');
      }
      await this.prisma.modelCatalogSync.create({ data: { source: 'ai', proposed } });
      return { source: 'ai', skipped: false, proposed };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.modelCatalogSync.create({ data: { source: 'ai', error: message } });
      this.logger.warn(`Complément IA du catalogue KO : ${message}`);
      return { source: 'ai', skipped: true, proposed: 0 };
    }
  }

  async pendingProposals() {
    return this.prisma.modelCatalogProposal.findMany({
      where: { appliedAt: null, rejectedAt: null },
      orderBy: [{ pattern: 'asc' }, { field: 'asc' }],
    });
  }

  /** Applique les propositions choisies. C'est le SEUL chemin d'écriture automatique. */
  async applyProposals(ids: string[]): Promise<{ applied: number }> {
    const proposals = await this.prisma.modelCatalogProposal.findMany({
      where: { id: { in: ids }, appliedAt: null, rejectedAt: null },
    });
    let applied = 0;
    for (const proposal of proposals) {
      const row = await this.prisma.modelCatalog.findUnique({ where: { pattern: proposal.pattern } });
      if (!row) continue;
      await this.prisma.modelCatalog.update({
        where: { id: row.id },
        data: {
          ...columnValue(proposal.field as RefreshableField, proposal.proposedValue),
          source: row.source === 'custom' ? 'custom' : 'refresh',
          checkedAt: new Date(),
        },
      });
      await this.prisma.modelCatalogProposal.update({
        where: { id: proposal.id },
        data: { appliedAt: new Date() },
      });
      applied++;
    }
    return { applied };
  }

  async rejectProposals(ids: string[]): Promise<{ rejected: number }> {
    const result = await this.prisma.modelCatalogProposal.updateMany({
      where: { id: { in: ids }, appliedAt: null, rejectedAt: null },
      data: { rejectedAt: new Date() },
    });
    return { rejected: result.count };
  }

  /** Une proposition par champ qui diffère. Un champ amont `null` ne propose rien. */
  private async proposeDiff(
    row: ModelCatalog,
    upstream: Partial<ModelCatalogEntry>,
    origin: string,
    evidence: string,
  ): Promise<number> {
    let count = 0;
    for (const field of REFRESHABLE) {
      const proposed = (upstream as Record<string, unknown>)[field];
      if (proposed === undefined || proposed === null) continue;
      const current = currentValue(row, field);
      if (sameValue(current, proposed)) continue;
      await this.prisma.modelCatalogProposal.upsert({
        where: { pattern_field: { pattern: row.pattern, field } },
        create: {
          pattern: row.pattern,
          field,
          currentValue: current as never,
          proposedValue: proposed as never,
          origin,
          evidence,
        },
        update: {
          currentValue: current as never,
          proposedValue: proposed as never,
          origin,
          evidence,
          appliedAt: null,
          rejectedAt: null,
        },
      });
      count++;
    }
    return count;
  }

  /** `checkedAt` bouge même sans changement : c'est ce qui mesure la fraîcheur. */
  private async touchAll(): Promise<void> {
    await this.prisma.modelCatalog.updateMany({ data: { checkedAt: new Date() } });
  }
}

function currentValue(row: ModelCatalog, field: RefreshableField): unknown {
  const value = (row as unknown as Record<string, unknown>)[field];
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function columnValue(field: RefreshableField, value: unknown): Record<string, unknown> {
  if (field === 'retiresAt') return { retiresAt: value ? new Date(String(value)) : null };
  if (field === 'status') return { status: asModelStatus(value) };
  if (field === 'tier') return { tier: asTier(value) };
  return { [field]: value };
}

function sameValue(current: unknown, proposed: unknown): boolean {
  if (typeof current === 'number' && typeof proposed === 'number') {
    return Math.abs(current - proposed) < 1e-6;
  }
  return String(current ?? '') === String(proposed ?? '');
}

interface AiModelAnswer {
  pattern?: string;
  status?: string | null;
  retiresAt?: string | null;
  replacedByPattern?: string | null;
  tier?: string | null;
}

function sparseEntry(row: ModelCatalog, item: AiModelAnswer): Partial<ModelCatalogEntry> {
  return {
    status: item.status ? asModelStatus(item.status) : undefined,
    retiresAt: item.retiresAt ?? undefined,
    replacedByPattern: item.replacedByPattern ?? undefined,
    // Le niveau d'une ligne déjà posée à la main ne se rediscute pas ici.
    tier: item.tier && row.source !== 'custom' ? asTier(item.tier) : undefined,
  };
}

function parseModels(text: string): AiModelAnswer[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { models?: AiModelAnswer[] };
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}
