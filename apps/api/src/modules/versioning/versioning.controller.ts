import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { WorkflowVersion } from '@prisma/client';
import { VCS_PORT, VcsPort, VcsRepo } from '@nwm/core';
import { VersioningService } from './versioning.service';
import { VersionExportService } from './version-export.service';
import { ExportPreview, RestorePreview, VersionPreviewService } from './version-preview.service';
import { LatestVersion, VersionDiff, VersionHistoryService } from './version-history.service';
import { VersionFamiliesService, VersionFamilyRow } from './version-families.service';
import { CleanupReport, ExportCleanupService } from './export-cleanup.service';
import { ArchiveReport, ExportArchiveService } from './export-archive.service';
import { ExportTargetInput, ExportTargetView, ExportTargetsService } from './export-targets.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

@ModuleId('versioning')
@Controller()
export class VersioningController {
  constructor(
    private readonly versioning: VersioningService,
    private readonly exporter: VersionExportService,
    private readonly preview: VersionPreviewService,
    private readonly history: VersionHistoryService,
    private readonly families: VersionFamiliesService,
    private readonly cleanup: ExportCleanupService,
    private readonly archive: ExportArchiveService,
    private readonly targets: ExportTargetsService,
    @Inject(VCS_PORT) private readonly vcs: VcsPort,
  ) {}

  /**
   * Résout le token GitHub : celui du body, sinon celui déjà enregistré pour la
   * cible (`targetId` — l'UI ne revoit jamais les secrets), sinon GITHUB_TOKEN.
   */
  private async resolveToken(token?: string, targetId?: string): Promise<string> {
    const stored = !token && targetId ? await this.targets.storedSecret(targetId) : undefined;
    const resolved = token || stored || process.env.GITHUB_TOKEN;
    if (!resolved) throw new BadRequestException('Token GitHub manquant (champ token ou GITHUB_TOKEN)');
    return resolved;
  }

  // --- Intégration GitHub (formulaire cible d'export) ---

  /** Repos accessibles par le token (rempli le select du formulaire). */
  @Post('export-targets/github/repos')
  async listRepos(@Body() body: { token?: string; targetId?: string }): Promise<VcsRepo[]> {
    return this.vcs.listRepos(await this.resolveToken(body.token, body.targetId));
  }

  @Post('export-targets/github/branches')
  async listBranches(
    @Body() body: { token?: string; targetId?: string; owner: string; repo: string },
  ): Promise<string[]> {
    return this.vcs.listBranches({
      token: await this.resolveToken(body.token, body.targetId),
      owner: body.owner,
      repo: body.repo,
    });
  }

  /** Teste l'accès au repo/branche avant sauvegarde. */
  @Post('export-targets/test')
  async testTarget(
    @Body()
    body: {
      kind: string;
      targetId?: string;
      config: { owner?: string; repo?: string; branch?: string; token?: string };
    },
  ): Promise<{ ok: boolean; error?: string }> {
    if (body.kind !== 'github') {
      return { ok: false, error: 'Test disponible uniquement pour GitHub pour le moment' };
    }
    const { owner, repo, branch } = body.config ?? {};
    if (!owner || !repo) return { ok: false, error: 'owner et repo requis' };
    return this.vcs.testAccess({
      owner,
      repo,
      branch,
      token: await this.resolveToken(body.config?.token, body.targetId),
    });
  }

  // --- Versions (resource Refine "versions") ---

  @Get('versions')
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowVersion[]> {
    const { data, total } = await this.versioning.listVersions(
      query.workflowId,
      query.instanceId,
      toPrismaListArgs(query, 'createdAt'),
    );
    return withTotalCount(res, total, data);
  }

  /**
   * Une ligne par workflow (sa dernière version) : la liste à plat est illisible
   * dès qu'un workflow change toutes les heures — il y occupe toutes les pages,
   * et les autres workflows n'y apparaissent plus. L'historique complet reste
   * servi par `GET /versions?workflowId=`.
   */
  @Get('versions/latest')
  async listLatest(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LatestVersion[]> {
    const { data, total } = await this.history.listLatest(
      query.instanceId,
      query.workflowId,
      toPrismaListArgs(query, 'createdAt'),
    );
    return withTotalCount(res, total, data);
  }

  /**
   * Une ligne par workflow MÉTIER : ses environnements dessous, et sous chacun
   * son historique (`GET /versions?workflowId=`). Trois niveaux, parce que la
   * question posée à cette page est « où en est ce workflow, et qu'est-ce que
   * la prod a de moins que la dev ? » — pas « qu'a fait cet exemplaire ».
   */
  @Get('versions/families')
  async listFamilies(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VersionFamilyRow[]> {
    const { data, total } = await this.families.list(
      query.instanceId,
      query.workflowId,
      toPrismaListArgs(query, 'createdAt'),
    );
    return withTotalCount(res, total, data);
  }

  /** Ce que cette version a changé par rapport à celle qui la précède. */
  @Get('versions/:id/diff')
  diff(@Param('id') id: string): Promise<VersionDiff> {
    return this.history.diffWithPrevious(id);
  }

  @Get('versions/:id')
  get(@Param('id') id: string): Promise<WorkflowVersion> {
    return this.versioning.getVersion(id);
  }

  /** Impact d'une restauration (ce qui sera écrasé dans n8n), avant confirmation. */
  @Get('versions/:id/restore-preview')
  restorePreview(@Param('id') id: string): Promise<RestorePreview> {
    return this.preview.restorePreview(id);
  }

  /** Destinations et contenu d'un export, avant confirmation. */
  @Get('versions/:id/export-preview')
  exportPreview(@Param('id') id: string): Promise<ExportPreview> {
    return this.preview.exportPreview(id);
  }

  @Post('versions/:id/restore')
  restore(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.versioning.restore(id);
  }

  @Post('versions/:id/export')
  export(@Param('id') id: string): Promise<{ exported: string[] }> {
    return this.exporter.exportVersion(id);
  }

  /** Exporte la dernière version de chaque workflow (?force=1 pour tout ré-exporter). */
  @Post('versions/export-all')
  exportAll(@Query('force') force?: string): Promise<{ exported: number; skipped: number; failed: number }> {
    return this.exporter.exportAll(force === '1' || force === 'true');
  }

  /**
   * Range les exports des workflows retirés côté n8n dans `archived/` (et en
   * ressort ceux que n8n a remis en service), sans attendre la prochaine
   * synchro : `?instanceId=` pour se limiter à une instance.
   */
  @Post('versions/archive-sweep')
  archiveSweep(@Query('instanceId') instanceId?: string): Promise<ArchiveReport> {
    return this.archive.sweep(instanceId);
  }

  /** Doublons laissés par les renommages dans une cible (lecture seule). */
  @Get('export-targets/:id/cleanup')
  cleanupPreview(@Param('id') id: string): Promise<CleanupReport> {
    return this.cleanup.preview(id);
  }

  /** Supprime les fichiers marqués « doublon » par l'aperçu ci-dessus. */
  @Post('export-targets/:id/cleanup')
  cleanupApply(@Param('id') id: string): Promise<CleanupReport> {
    return this.cleanup.apply(id);
  }

  // --- Cibles d'export (resource Refine "export-targets") ---
  // Les secrets du config (token GitHub, accessToken Drive) ne sortent jamais
  // d'ici : voir ExportTargetsService (`hasToken` + conservation à l'update).

  @Get('export-targets')
  async listTargets(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExportTargetView[]> {
    const { orderBy } = toPrismaListArgs(query, 'name', 'asc');
    const targets = await this.targets.list({ orderBy });
    return withTotalCount(res, targets.length, targets);
  }

  @Get('export-targets/:id')
  getTarget(@Param('id') id: string): Promise<ExportTargetView> {
    return this.targets.get(id);
  }

  @Post('export-targets')
  createTarget(@Body() body: ExportTargetInput): Promise<ExportTargetView> {
    return this.targets.create(body);
  }

  @Patch('export-targets/:id')
  updateTarget(@Param('id') id: string, @Body() body: Partial<ExportTargetInput>): Promise<ExportTargetView> {
    return this.targets.update(id, body);
  }

  @Delete('export-targets/:id')
  deleteTarget(@Param('id') id: string): Promise<ExportTargetView> {
    return this.targets.delete(id);
  }
}
