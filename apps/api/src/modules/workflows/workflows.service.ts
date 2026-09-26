import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Workflow } from '@prisma/client';
import {
  EnvDivergence,
  EnvName,
  N8nWorkflow,
  detectPublishModel,
  detectWorkflowEnv,
  isWorkflowArchived,
  MAKE_CAPABILITIES,
  N8N_CAPABILITIES,
  WorkflowActions,
  makeScenarioUrl,
  workflowActions,
  n8nWorkflowUrl,
  msg,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { ARCHIVED_WORKFLOW_WHERE } from '../../infra/settings/archived-workflows.where';
import { PrismaListArgs } from '../../common/crud/paginate';
import { WorkflowSyncService } from './workflow-sync.service';

/** Workflow enrichi de son env déduit (tag env:x ou suffixe du nom), de son URL n8n et du nombre de monitors. */
export type WorkflowWithEnv = Workflow & {
  env: EnvName | null;
  n8nUrl: string;
  monitorCount: number;
  /** La plateforme de l'instance : elle dit avec quel code lire `raw`. */
  platform: 'n8n' | 'make';
  /** Make seulement : de quoi refaire le lien vers l'éditeur du scénario. */
  zone: string | null;
  externalTeamId: string | null;
  /**
   * Ce que l'écran a le droit de proposer. Servi par l'API et non recalculé
   * côté web : le web ne dépend pas de `@nwm/core`, et deux tables de vérité
   * divergeraient au premier module porté.
   */
  actions: WorkflowActions;
  /** Archivé, quel qu'en soit le moyen : tag, préfixe, ou archivage natif n8n (`archivedUpstream`). */
  archived: boolean;
  /** n8n ne connaît plus ce workflow (supprimé côté n8n) ; la copie locale reste consultable. */
  missingInN8n: boolean;
  /**
   * Publié sur les n8n qui séparent brouillon et version publiée ; `null` sur une
   * instance qui ne les sépare pas. Un `false` explique à lui seul un workflow que
   * l'éditeur n8n renvoie vers « Nouveau workflow » : il ouvre la version publiée,
   * et il n'y en a pas.
   */
  published: boolean | null;
  /**
   * Groupes métier auxquels il appartient (module `workflow-groups`). Servi avec
   * la ligne et non demandé à part : sans lui, rien sur la page d'un workflow ne
   * rappelle qu'il fait partie d'un domaine, et le module s'oublie.
   */
  groups: Array<{ id: string; name: string }>;
  /** Écart avec la prod du même workflow métier ; servi par les listes seulement. */
  divergence?: EnvDivergence | null;
};

/** Filtres de la liste des workflows (mêmes valeurs pour la vue plate et la vue groupée). */
export interface WorkflowListFilters {
  instanceId?: string;
  q?: string;
  env?: string;
  active?: string;
  /** Membres de ce groupe seulement. */
  groupId?: string;
  /** `true` = archivés seulement, `false` = non archivés, `all` = tout ; absent = réglage global. */
  archived?: string;
  /** Écart avec la prod : un id d'env (ses exemplaires à déployer), `behind` ou `diverged`. */
  divergence?: string;
}

type WorkflowWithInstance = Workflow & {
  instance: { baseUrl: string; platform: string; zone: string | null; externalTeamId: string | null };
  _count: { monitors: number };
  groups: Array<{ id: string; name: string }>;
};

/** Lu sur le JSON n8n conservé verbatim : la colonne `raw` est la seule à le porter. */
function publishedState(raw: N8nWorkflow | null): boolean | null {
  if (!raw) return null;
  const model = detectPublishModel(raw);
  return model === 'direct' ? null : model === 'versioned-published';
}

function withEnv(workflow: WorkflowWithInstance, envs: readonly string[]): WorkflowWithEnv {
  const { instance, _count, groups, ...rest } = workflow;
  return {
    ...rest,
    env: detectWorkflowEnv(workflow.name, workflow.tags, envs),
    archived: isWorkflowArchived(workflow.name, workflow.tags) || workflow.archivedUpstream,
    missingInN8n: workflow.missingUpstreamAt !== null,
    // Le lien vers l'éditeur d'origine : chaque plateforme a le sien, et un lien
    // n8n posé sur un scénario Make mènerait à une page qui n'existe pas.
    n8nUrl:
      instance.platform === 'make'
        ? makeScenarioUrl(instance.zone, instance.externalTeamId, workflow.externalId)
        : n8nWorkflowUrl(instance.baseUrl, workflow.externalId),
    monitorCount: _count.monitors,
    platform: instance.platform === 'make' ? 'make' : 'n8n',
    actions: workflowActions(
      instance.platform === 'make' ? 'make' : 'n8n',
      instance.platform === 'make' ? MAKE_CAPABILITIES : N8N_CAPABILITIES,
    ),
    zone: instance.zone,
    externalTeamId: instance.externalTeamId,
    groups,
    published: instance.platform === 'make' ? null : publishedState(workflow.raw as unknown as N8nWorkflow),
  };
}

const includeInstance = {
  instance: { select: { baseUrl: true, platform: true, zone: true, externalTeamId: true } },
  _count: { select: { monitors: true } },
  groups: { select: { id: true, name: true }, orderBy: { name: 'asc' as const } },
} as const;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly sync: WorkflowSyncService,
  ) {}

  async list(
    args: PrismaListArgs,
    filters: WorkflowListFilters,
  ): Promise<{ data: WorkflowWithEnv[]; total: number }> {
    const where = await this.buildWhere(filters);
    const [data, total] = await Promise.all([
      this.prisma.workflow.findMany({ where, ...args, include: includeInstance }),
      this.prisma.workflow.count({ where }),
    ]);
    const envs = await this.settings.declaredEnvIds();
    const enriched = data.map((row) => withEnv(row, envs));
    // Filtre env post-requête (champ dérivé, pas en DB)
    if (filters.env) {
      const filtered = enriched.filter((w) => w.env === filters.env);
      return { data: filtered, total: filtered.length };
    }
    return { data: enriched, total };
  }

  /** Tous les workflows d'un filtre, sans pagination (regroupement par famille). */
  async listAll(
    filters: WorkflowListFilters,
    orderBy: PrismaListArgs['orderBy'] = { name: 'asc' },
  ): Promise<WorkflowWithEnv[]> {
    const rows = await this.prisma.workflow.findMany({
      where: await this.buildWhere(filters),
      orderBy,
      include: includeInstance,
    });
    const envs = await this.settings.declaredEnvIds();
    const enriched = rows.map((row) => withEnv(row, envs));
    return filters.env ? enriched.filter((w) => w.env === filters.env) : enriched;
  }

  private async buildWhere(filters: WorkflowListFilters): Promise<Prisma.WorkflowWhereInput> {
    return {
      ...(filters.instanceId ? { instanceId: filters.instanceId } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: 'insensitive' } } : {}),
      ...(filters.groupId ? { groups: { some: { id: filters.groupId } } } : {}),
      ...(filters.active === 'true' || filters.active === 'false'
        ? { active: filters.active === 'true' }
        : {}),
      AND: [
        // Sans filtre explicite, on suit le réglage global (archivés exclus par défaut).
        ...(filters.archived === 'all'
          ? []
          : filters.archived === 'true'
            ? [ARCHIVED_WORKFLOW_WHERE]
            : filters.archived === 'false'
              ? [{ NOT: ARCHIVED_WORKFLOW_WHERE }]
              : await this.settings.archivedFilter()),
        // Les workflows supprimés dans n8n ne se montrent que si le réglage le demande.
        ...(await this.settings.missingFilter()),
        // Bouchons et copies de test : jamais listés, même sous `archived=all`.
        ...this.settings.testerFilter(),
      ],
    };
  }

  async get(id: string): Promise<WorkflowWithEnv> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id }, include: includeInstance });
    if (!workflow) throw new NotFoundException(msg('platform.workflowNotFound', { id }));
    return withEnv(workflow, await this.settings.declaredEnvIds());
  }

  async setTimeSaved(id: string, minutes: number | null): Promise<void> {
    await this.prisma.workflow.update({
      where: { id },
      data: { minutesSavedPerExecution: minutes },
    });
  }

  /**
   * Le contenu d'un workflow n8n.
   *
   * REFUSE un workflow servi par une autre plateforme, et c'est tout l'intérêt :
   * une trentaine de services lisent `raw` en le typant `N8nWorkflow` sans jamais
   * vérifier d'où il vient. Sur un blueprint Make, ils tombaient sur
   * « Cannot read properties of undefined (reading 'map') » — une 500 qui ne dit
   * rien à personne. Un refus nommé, au contraire, se lit à l'écran et dit quoi
   * faire. Les services qui savent gérer les deux passent par `getRawAny`.
   */
  async getRaw(id: string): Promise<{ workflow: WorkflowWithEnv; raw: N8nWorkflow }> {
    const workflow = await this.get(id);
    if (workflow.platform !== 'n8n') {
      throw new BadRequestException(
        msg('platform.workflowNotN8n', {
          name: workflow.name,
          platform: workflow.platform === 'make' ? 'Make' : workflow.platform,
        }),
      );
    }
    return { workflow, raw: workflow.raw as unknown as N8nWorkflow };
  }

  /** Le contenu tel quel, quelle que soit la plateforme : à l'appelant de savoir le lire. */
  async getRawAny(id: string): Promise<{ workflow: WorkflowWithEnv; raw: unknown }> {
    const workflow = await this.get(id);
    return { workflow, raw: workflow.raw as unknown };
  }

  /**
   * Même chose, après avoir redemandé le workflow à n8n. La copie locale date au
   * mieux du dernier cron : la lire suffit à juger sur un état périmé, mais la
   * RÉÉCRIRE renvoie cet état à n8n et efface ce qui a été fait dans l'éditeur
   * entre-temps. Tout chemin qui mène à un PUT passe donc par ici. `missing` :
   * n8n ne connaît plus ce workflow, la copie reste lisible mais rien n'y sera écrit.
   */
  async getFreshRaw(id: string): Promise<{ workflow: WorkflowWithEnv; raw: N8nWorkflow; missing: boolean }> {
    const report = await this.sync.syncWorkflow(id);
    return { ...(await this.getRaw(id)), missing: report.missing };
  }

  /** Même chose, quelle que soit la plateforme : pour une LECTURE, jamais pour réécrire du n8n. */
  async getFreshRawAny(id: string): Promise<{ workflow: WorkflowWithEnv; raw: unknown; missing: boolean }> {
    const report = await this.sync.syncWorkflow(id);
    return { ...(await this.getRawAny(id)), missing: report.missing };
  }
}
