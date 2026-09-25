import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AI_PORT, AiPort, AiProvider, isAiProvider } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { activeAiProvider, aiCredentialsSource } from '../../infra/adapters/ai-credentials.provider';
import { AI_PROVIDER_INFOS, aiProviderInfo } from '../../infra/adapters/ai-providers';

export interface AiSettingsInput {
  /** Fournisseur visé ; absent, c'est celui qui sert déjà les appels. */
  provider?: string;
  /** Vide ou absent lors d'un update : conserve la clé existante. */
  apiKey?: string;
  model?: string;
  /** Faire de ce fournisseur celui qui sert les appels. */
  activate?: boolean;
}

export interface AiProviderView {
  id: AiProvider;
  label: string;
  defaultModel: string;
  envKey: string;
  hasKey: boolean;
  model: string | null;
  /** Origine des credentials de CE fournisseur : réglages DB, variables d'env, ou rien. */
  source: 'db' | 'env' | 'none';
}

export interface AiSettingsView {
  /** Fournisseur qui sert les appels. */
  provider: AiProvider;
  providers: AiProviderView[];
  /** État du fournisseur actif, repris à plat pour les écrans qui n'affichent que lui. */
  hasKey: boolean;
  model: string | null;
  source: 'db' | 'env' | 'none';
}

/**
 * Réglages IA : une ligne par fournisseur (clé + modèle, la clé n'est jamais
 * renvoyée), et lequel des deux sert les appels. Deux clés cohabitent exprès —
 * basculer parce que l'un est plafonné ne doit pas coûter une ressaisie.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PORT) private readonly ai: AiPort,
  ) {}

  async get(): Promise<AiSettingsView> {
    const active = await activeAiProvider(this.prisma);
    const rows = await this.prisma.aiSettings.findMany();
    const providers: AiProviderView[] = [];
    for (const info of AI_PROVIDER_INFOS) {
      const row = rows.find((candidate) => candidate.id === info.id);
      providers.push({
        ...info,
        hasKey: Boolean(row?.apiKey),
        model: row?.model ?? null,
        source: await aiCredentialsSource(this.prisma, info.id),
      });
    }
    const current = providers.find((candidate) => candidate.id === active);
    return {
      provider: active,
      providers,
      hasKey: current?.hasKey ?? false,
      model: current?.model ?? null,
      source: current?.source ?? 'none',
    };
  }

  async save(input: AiSettingsInput): Promise<AiSettingsView> {
    const provider = await this.resolveProvider(input.provider);
    const info = aiProviderInfo(provider);
    const apiKey = input.apiKey?.trim() || undefined;
    const model = input.model?.trim() || null;

    const existing = await this.prisma.aiSettings.findUnique({ where: { id: provider } });
    if (!apiKey && !existing?.apiKey) {
      throw new BadRequestException(`Clé API ${info.label} requise`);
    }

    await this.prisma.aiSettings.upsert({
      where: { id: provider },
      create: { id: provider, apiKey: apiKey ?? '', model, active: input.activate ?? false },
      update: { model, ...(apiKey ? { apiKey } : {}) },
    });
    if (input.activate) await this.activate(provider);
    return this.get();
  }

  /**
   * Bascule le fournisseur servant les appels. En transaction : hors d'elle, une
   * coupure entre les deux écritures laisserait la plateforme sans fournisseur
   * actif — donc rendue au défaut, sans que personne ne l'ait demandé.
   */
  async activate(provider: AiProvider): Promise<AiSettingsView> {
    const source = await aiCredentialsSource(this.prisma, provider);
    if (source === 'none') {
      const info = aiProviderInfo(provider);
      throw new BadRequestException(
        `${info.label} n'a pas de clé API : la renseigner avant de basculer (ou poser ${info.envKey})`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.aiSettings.updateMany({ where: { active: true }, data: { active: false } }),
      this.prisma.aiSettings.upsert({
        where: { id: provider },
        create: { id: provider, active: true },
        update: { active: true },
      }),
    ]);
    return this.get();
  }

  /** Supprime les réglages DB d'un fournisseur : retour au fallback variables d'env. */
  async clear(provider?: string): Promise<AiSettingsView> {
    const target = await this.resolveProvider(provider);
    await this.prisma.aiSettings.deleteMany({ where: { id: target } });
    return this.get();
  }

  /**
   * Teste un appel IA minimal. Avec un body (formulaire), teste ces valeurs avant
   * sauvegarde (clé absente : reprend celle stockée) ; sans body, teste les
   * credentials effectifs. Le test vise le fournisseur du formulaire, pas
   * l'actif : c'est ainsi qu'on vérifie une clé avant de basculer dessus.
   */
  async test(input?: AiSettingsInput): Promise<{ ok: true }> {
    const provider = await this.resolveProvider(input?.provider);
    try {
      const apiKey =
        input?.apiKey?.trim() ||
        (await this.prisma.aiSettings.findUnique({ where: { id: provider } }))?.apiKey;
      const model = input?.model?.trim() || undefined;
      if (apiKey) await this.ai.testCredentials({ apiKey, model, provider });
      else await this.ai.testCredentials();
    } catch (error) {
      throw new BadRequestException(`Appel IA KO : ${(error as Error).message}`);
    }
    return { ok: true };
  }

  /** Un fournisseur absent vaut l'actif ; un fournisseur inconnu est une erreur, jamais un repli. */
  private async resolveProvider(provider?: string): Promise<AiProvider> {
    if (provider === undefined || provider === '') return activeAiProvider(this.prisma);
    if (!isAiProvider(provider)) {
      throw new BadRequestException(`Fournisseur IA inconnu : ${provider}`);
    }
    return provider;
  }
}
