import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WorkflowListFilters, WorkflowWithEnv, WorkflowsService } from './workflows.service';
import { WorkflowFamiliesService, WorkflowFamilyRow } from './workflow-families.service';
import { WorkflowDivergenceService } from './workflow-divergence.service';
import {
  WorkflowDivergenceDetail,
  WorkflowDivergenceDetailService,
} from './workflow-divergence-detail.service';
import { SyncReport, WorkflowSyncReport, WorkflowSyncService } from './workflow-sync.service';
import { SearchSyncReport, WorkflowSearchSyncService } from './workflow-search-sync.service';
import { WorkflowCreateService } from './workflow-create.service';
import { WorkflowArchiveService } from './workflow-archive.service';
import { PublishResult, WorkflowPublishService } from './workflow-publish.service';
import { WorkflowView, WorkflowViewService } from './workflow-view.service';
import { WorkflowExportService, WorkflowJsonExport } from './workflow-export.service';
import { TimeSavedService, TimeSavedView } from './time-saved.service';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

function toFilters(query: RefineListQuery): WorkflowListFilters {
  return {
    instanceId: query.instanceId,
    q: query.q,
    env: query.env,
    active: query.active,
    archived: query.archived,
    groupId: query.groupId,
    divergence: query.divergence,
  };
}

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly families: WorkflowFamiliesService,
    private readonly divergence: WorkflowDivergenceService,
    private readonly divergenceDetail: WorkflowDivergenceDetailService,
    private readonly sync: WorkflowSyncService,
    private readonly searchSync: WorkflowSearchSyncService,
    private readonly archive: WorkflowArchiveService,
    private readonly view: WorkflowViewService,
    private readonly jsonExport: WorkflowExportService,
    private readonly creation: WorkflowCreateService,
    private readonly publication: WorkflowPublishService,
    private readonly timeSaved: TimeSavedService,
  ) {}

  /** Workflow neuf (vide, inactif) sur une instance n8n : l'assistant le remplit ensuite. */
  @Post()
  create(@Body() body: { instanceId?: string; name?: string }): Promise<WorkflowWithEnv> {
    if (!body?.instanceId) throw new BadRequestException('instanceId attendu');
    return this.creation.create(body.instanceId, body.name ?? '');
  }

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowWithEnv[]> {
    const args = toPrismaListArgs(query, 'name', 'asc');
    const filters = toFilters(query);
    const { data, total } = filters.divergence
      ? await this.divergence.listFiltered(args, filters)
      : await this.workflows.list(args, filters);
    return withTotalCount(res, total, await this.divergence.annotate(data));
  }

  /**
   * Même liste, regroupée par workflow métier : un workflow présent en dev et en
   * prod fait une seule ligne, ses environnements en membres.
   * Déclarée avant `:id`, sinon « families » serait pris pour un identifiant.
   */
  @Get('families')
  async listFamilies(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowFamilyRow[]> {
    const { data, total } = await this.families.list(
      toPrismaListArgs(query, 'name', 'asc'),
      toFilters(query),
    );
    return withTotalCount(res, total, data);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<WorkflowWithEnv> {
    return this.workflows.get(id);
  }

  /** Minutes de travail manuel économisées par exécution (ROI) ; null pour effacer. */
  @Patch(':id/time-saved')
  async setTimeSaved(
    @Param('id') id: string,
    @Body() body: { minutes?: number | null },
  ): Promise<{ ok: true }> {
    const minutes = body.minutes ?? null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      throw new BadRequestException('minutes : nombre positif attendu');
    }
    await this.workflows.setTimeSaved(id, minutes);
    return { ok: true };
  }

  /** Le chiffre retenu pour le ROI, et l'estimation qui sert tant que personne n'a saisi le sien. */
  @Get(':id/time-saved')
  getTimeSaved(@Param('id') id: string): Promise<TimeSavedView> {
    return this.timeSaved.view(id);
  }

  /**
   * Réestime CE workflow, affiné par l'IA quand elle est configurée. N'écrase
   * jamais la saisie humaine : c'est l'estimation qui est refaite.
   */
  @Post(':id/time-saved/estimate')
  estimateTimeSaved(@Param('id') id: string): Promise<TimeSavedView> {
    return this.timeSaved.refine(id);
  }

  /** Le même workflow métier dans ses autres environnements (navigation dev ↔ prod). */
  @Get(':id/siblings')
  listSiblings(@Param('id') id: string): Promise<WorkflowWithEnv[]> {
    return this.families.siblings(id);
  }

  /**
   * Ce qui diffère entre cet exemplaire et la prod de son workflow métier, au sens
   * de la colonne « Écart prod » (`referenceId` pour choisir parmi plusieurs prods).
   */
  @Get(':id/divergence')
  getDivergence(
    @Param('id') id: string,
    @Query('referenceId') referenceId?: string,
  ): Promise<WorkflowDivergenceDetail> {
    return this.divergenceDetail.detail(id, referenceId);
  }

  /** Vue lecture (graphe Mermaid + inventaire des nœuds) — indépendante des modules optionnels. */
  @Get(':id/view')
  getView(@Param('id') id: string): Promise<WorkflowView> {
    return this.view.get(id);
  }

  /**
   * JSON du workflow, nettoyé de l'identité de son exemplaire d'origine : à
   * copier vers une IA ou à réimporter à la main dans un n8n. Repart de n8n
   * (`fresh=0` pour s'en tenir au miroir local) et n'embarque les données
   * épinglées que sur demande — c'est de la donnée de production.
   */
  @Get(':id/export')
  exportJson(
    @Param('id') id: string,
    @Query('fresh') fresh?: string,
    @Query('pinData') pinData?: string,
  ): Promise<WorkflowJsonExport> {
    return this.jsonExport.export(id, { fresh: fresh !== '0', includePinData: pinData === '1' });
  }

  /** Repull d'un seul workflow depuis n8n (la copie locale peut dater d'une heure). */
  @Post(':id/resync')
  resync(@Param('id') id: string): Promise<WorkflowSyncReport> {
    return this.sync.syncWorkflow(id);
  }

  /**
   * Synchro déclenchée par une recherche restée sans résultat : le miroir peut
   * dater d'une heure. Le service la refuse d'elle-même si elle vient d'avoir
   * lieu — la route est appelée par la frappe, pas par un clic.
   */
  @Post('search-sync')
  searchSyncInstances(@Body() body: { instanceId?: string }): Promise<SearchSyncReport> {
    return this.searchSync.syncForSearch(body?.instanceId);
  }

  @Post('sync/:instanceId')
  syncInstance(@Param('instanceId') instanceId: string): Promise<SyncReport> {
    return this.sync.syncInstance(instanceId);
  }

  /** Archivage doux : tag `archived` + préfixe `[ARCHIVED]` dans n8n, rien d'autre. */
  @Post(':id/archive')
  archiveWorkflow(@Param('id') id: string): Promise<WorkflowWithEnv> {
    return this.archive.archive(id);
  }

  @Post(':id/unarchive')
  unarchiveWorkflow(@Param('id') id: string): Promise<WorkflowWithEnv> {
    return this.archive.unarchive(id);
  }

  /**
   * Publie le workflow (n8n 2.x) : la version courante devient celle qui tourne.
   * C'est une mise en production, donc une route à part et jamais un effet de bord
   * d'une écriture — un workflow jamais publié ne doit pas se mettre à tourner
   * parce qu'on lui a appliqué un diff.
   */
  @Post(':id/publish')
  publishWorkflow(@Param('id') id: string): Promise<PublishResult> {
    return this.publication.publish(id);
  }
}
