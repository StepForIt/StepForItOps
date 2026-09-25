import { Injectable } from '@nestjs/common';
import {
  DeployKeyContext,
  DeployKeyMapping,
  EnvDivergence,
  EnvDivergenceMember,
  N8nWorkflow,
  deployKey,
  detectWorkflowEnv,
  envDivergence,
  hashContent,
  matchesDivergenceFilter,
  workflowFamilyKey,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { ARCHIVED_WORKFLOW_WHERE } from '../../infra/settings/archived-workflows.where';
import { PrismaListArgs } from '../../common/crud/paginate';
import { WorkflowListFilters, WorkflowWithEnv, WorkflowsService } from './workflows.service';

/**
 * Écart de chaque exemplaire avec la prod de son workflow métier, sur l'empreinte
 * de déploiement (`deployKey`) : ce qu'une promotion changerait, et rien d'autre.
 *
 * La comparaison porte TOUJOURS sur le parc entier, jamais sur la page ni sur les
 * filtres de la liste : filtrer sur une instance ne doit pas faire disparaître la
 * prod qui vit sur l'autre, et faire passer le dev pour « jamais déployé ». Archivés,
 * supprimés dans n8n et outils du tester n'y comptent pas, quel que soit le réglage
 * d'affichage : une prod archivée n'est plus la prod.
 *
 * Les empreintes sont gardées en mémoire, par contenu (`Workflow.hash`) : seul un
 * workflow modifié depuis la dernière lecture fait relire son JSON. Changer un mapping
 * ou renommer un workflow appelé les périme toutes, puisque la clé en dépend.
 */
@Injectable()
export class WorkflowDivergenceService {
  private cache = new Map<string, string | null>();
  private cacheStamp = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly workflows: WorkflowsService,
  ) {}

  async annotate<T extends WorkflowWithEnv>(rows: T[]): Promise<T[]> {
    const statuses = await this.statuses();
    return rows.map((row) => ({ ...row, divergence: statuses.get(row.id) ?? null }));
  }

  /**
   * Vue plate filtrée sur l'écart : l'écart n'est pas une colonne, la page ne se
   * découpe donc qu'une fois le filtre posé sur toute la liste.
   */
  async listFiltered(
    args: PrismaListArgs,
    filters: WorkflowListFilters,
  ): Promise<{ data: WorkflowWithEnv[]; total: number }> {
    const statuses = await this.statuses();
    const rows = (await this.workflows.listAll(filters, args.orderBy)).filter((row) =>
      matchesDivergenceFilter(filters.divergence ?? '', row.env, statuses.get(row.id)),
    );
    const start = args.skip ?? 0;
    return {
      data: rows.slice(start, args.take === undefined ? undefined : start + args.take),
      total: rows.length,
    };
  }

  /**
   * Ce dont `deployKey` a besoin, pour une instance donnée : les envs déclarés, les
   * mappings, et le nom de chaque workflow — un sous-workflow se nomme par
   * l'instance qui le porte. Servi aussi au détail de l'écart, pour que ce qu'il
   * montre soit calculé EXACTEMENT comme ce que la colonne constate.
   */
  async keyContext(): Promise<{ stamp: string; forInstance: (instanceId: string) => DeployKeyContext }> {
    const envs = await this.settings.declaredEnvIds();
    const [allNames, mappings] = await Promise.all([
      this.prisma.workflow.findMany({ select: { instanceId: true, externalId: true, name: true } }),
      this.prisma.resourceMapping.findMany({ select: { values: true }, orderBy: { id: 'asc' } }),
    ]);
    const mappingValues = mappings.map((m) => m.values as unknown as DeployKeyMapping);
    const names = new Map(allNames.map((w) => [`${w.instanceId}/${w.externalId}`, w.name] as const));
    return {
      stamp: hashContent({ envs, mappingValues, names: [...names.entries()].sort() }),
      forInstance: (instanceId) => ({
        envs,
        mappings: mappingValues,
        workflowName: (externalId) => names.get(`${instanceId}/${externalId}`),
      }),
    };
  }

  async statuses(): Promise<Map<string, EnvDivergence>> {
    const envs = await this.settings.declaredEnvIds();
    const [rows, context] = await Promise.all([
      this.prisma.workflow.findMany({
        where: {
          AND: [
            { NOT: ARCHIVED_WORKFLOW_WHERE },
            { missingUpstreamAt: null },
            ...this.settings.testerFilter(),
          ],
        },
        select: {
          id: true,
          name: true,
          tags: true,
          hash: true,
          instanceId: true,
          upstreamUpdatedAt: true,
          instance: { select: { platform: true } },
        },
      }),
      this.keyContext(),
    ]);

    if (context.stamp !== this.cacheStamp) {
      this.cache = new Map();
      this.cacheStamp = context.stamp;
    }

    const n8nRows = rows.filter((row) => row.instance.platform !== 'make');
    const missing = n8nRows.filter((row) => !this.cache.has(`${row.id}:${row.hash}`));
    if (missing.length > 0) {
      const raws = await this.prisma.workflow.findMany({
        where: { id: { in: missing.map((row) => row.id) } },
        select: { id: true, raw: true },
      });
      const byId = new Map(raws.map((row) => [row.id, row.raw] as const));
      for (const row of missing) {
        const raw = byId.get(row.id) as unknown as N8nWorkflow | undefined;
        const key = raw?.nodes ? deployKey(raw, context.forInstance(row.instanceId)) : null;
        this.cache.set(`${row.id}:${row.hash}`, key);
      }
    }

    const live = new Set(n8nRows.map((row) => `${row.id}:${row.hash}`));
    for (const key of this.cache.keys()) if (!live.has(key)) this.cache.delete(key);

    const families = new Map<string, EnvDivergenceMember[]>();
    for (const row of rows) {
      const family = workflowFamilyKey(row.name, envs);
      families.set(family, [
        ...(families.get(family) ?? []),
        {
          id: row.id,
          env: detectWorkflowEnv(row.name, row.tags, envs),
          key: this.cache.get(`${row.id}:${row.hash}`) ?? null,
          updatedAt: row.upstreamUpdatedAt,
        },
      ]);
    }
    const result = new Map<string, EnvDivergence>();
    for (const members of families.values()) {
      for (const [id, divergence] of envDivergence(members)) result.set(id, divergence);
    }
    return result;
  }
}
