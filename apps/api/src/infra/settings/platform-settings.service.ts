import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  EnvChain,
  EnvChainMode,
  EnvDefinition,
  Locale,
  envIds,
  envsFromChain,
  isLocale,
  normalizeEnvs,
} from '@nwm/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ARCHIVED_WORKFLOW_WHERE } from './archived-workflows.where';
import { MISSING_WORKFLOW_WHERE } from './missing-workflows.where';
import { TESTER_WORKFLOW_WHERE } from './tester-workflows.where';
import { BENCH_WORKFLOW_WHERE } from './bench-workflows.where';

/** Ligne unique des réglages transverses. */
export const PLATFORM_SETTINGS_ID = 'default';

export interface PlatformSettingsView {
  includeArchived: boolean;
  includeMissing: boolean;
  /** Environnements déclarés : leur id, leur rôle, et de qui chacun dépend. */
  envs: EnvDefinition[];
  /** Ids des envs déclarés, dans l'ordre d'affichage. Dérivé d'`envs`. */
  envChain: EnvChain;
  /** Ce qu'on fait d'une promotion qui saute une étape : avertir, ou refuser. */
  envChainMode: EnvChainMode;
  /** Langue de ce qui s'écrit hors requête : findings, alertes, textes d'un cron. */
  defaultLocale: Locale;
}

/**
 * Ce qu'on accepte en écriture : un client qui ne connaît que `envChain` — une
 * chaîne linéaire, l'ancien réglage — reste compris, ses envs étant relus d'elle.
 */
export type PlatformSettingsInput = Omit<PlatformSettingsView, 'envs' | 'defaultLocale'> & {
  envs?: EnvDefinition[];
  defaultLocale?: string;
};

/**
 * Réglages transverses de la plateforme. Par défaut les workflows archivés sont
 * exclus PARTOUT : listes, couverture d'analyse, graphes, monitoring, découverte
 * — ils ne sont donc pas analysés non plus (rien ne les remonte aux modules).
 * Même traitement pour ceux que n8n ne connaît plus (supprimés côté n8n) : ils
 * restent en base avec leur historique, mais sortent des vues par défaut.
 *
 * S'y ajoutent les workflows de travail posés par la plateforme elle-même
 * (bancs d'essai, bouchons, copies de test), exclus SANS réglage pour les lever.
 */
@Injectable()
export class PlatformSettingsService {
  /** Relue à chaque `get()` : la langue se demande en synchrone, au moment d'écrire un texte. */
  private cachedLocale: Locale = DEFAULT_LOCALE;

  constructor(private readonly prisma: PrismaService) {}

  defaultLocale(): Locale {
    return this.cachedLocale;
  }

  async get(): Promise<PlatformSettingsView> {
    const settings = await this.prisma.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
    });
    // Une ligne d'avant les envs déclarés n'a que sa chaîne linéaire : on la relit
    // comme une déclaration, plutôt que de lui imposer dev/preprod/prod.
    const envs = normalizeEnvs(settings?.envs ?? envsFromChain(settings?.envChain ?? []));
    this.cachedLocale = isLocale(settings?.defaultLocale) ? settings.defaultLocale : DEFAULT_LOCALE;
    return {
      includeArchived: settings?.includeArchived ?? false,
      includeMissing: settings?.includeMissing ?? false,
      envs,
      envChain: envIds(envs),
      envChainMode: settings?.envChainMode === 'block' ? 'block' : 'warn',
      defaultLocale: this.cachedLocale,
    };
  }

  async save(input: PlatformSettingsInput): Promise<PlatformSettingsView> {
    // Normalisée à l'écriture : une déclaration vide ou incohérente rendrait tout
    // chemin de promotion « inconnu », donc tout contrôle silencieux.
    const envs = normalizeEnvs(input.envs ?? input.envChain);
    const data = {
      includeArchived: Boolean(input.includeArchived),
      includeMissing: Boolean(input.includeMissing),
      envs: envs as unknown as Prisma.InputJsonValue,
      envChain: envIds(envs),
      envChainMode: input.envChainMode === 'block' ? 'block' : 'warn',
      // Un client qui ne connaît pas ce réglage garde celui en place.
      ...(isLocale(input.defaultLocale) ? { defaultLocale: input.defaultLocale } : {}),
    };
    await this.prisma.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      create: { id: PLATFORM_SETTINGS_ID, ...data },
      update: data,
    });
    return this.get();
  }

  /** Les envs déclarés, tels que les attendent les fonctions pures du domaine. */
  async declaredEnvs(): Promise<EnvDefinition[]> {
    return (await this.get()).envs;
  }

  /** Leurs seuls ids — ce que demandent la détection d'env et les clés de famille. */
  async declaredEnvIds(): Promise<string[]> {
    return (await this.get()).envChain;
  }

  /**
   * Fragment à fusionner dans un `where` Prisma sur Workflow :
   * `{ ...autres filtres, ...(await settings.workflowFilter()) }`.
   */
  async workflowFilter(): Promise<Prisma.WorkflowWhereInput> {
    const excluded = [
      ...(await this.archivedFilter()),
      ...(await this.missingFilter()),
      ...this.testerFilter(),
    ];
    return excluded.length ? { AND: excluded } : {};
  }

  /** Exclusion des archivés seule, pour une liste qui pilote son propre filtre d'archivage. */
  async archivedFilter(): Promise<Prisma.WorkflowWhereInput[]> {
    const { includeArchived } = await this.get();
    return includeArchived ? [] : [{ NOT: ARCHIVED_WORKFLOW_WHERE }];
  }

  /**
   * Exclusion des workflows de travail du module tester : bancs d'essai,
   * bouchons de sous-workflow et copies bouchonnées. Toujours, sans réglage
   * pour la lever — un archivé est un workflow rangé, ceux-ci sont des outils.
   */
  testerFilter(): Prisma.WorkflowWhereInput[] {
    return [{ NOT: BENCH_WORKFLOW_WHERE }, { NOT: TESTER_WORKFLOW_WHERE }];
  }

  /** Exclusion des workflows que n8n ne connaît plus (supprimés côté n8n). */
  async missingFilter(): Promise<Prisma.WorkflowWhereInput[]> {
    const { includeMissing } = await this.get();
    return includeMissing ? [] : [{ NOT: MISSING_WORKFLOW_WHERE }];
  }
}
