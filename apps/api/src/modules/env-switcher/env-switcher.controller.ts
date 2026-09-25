import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ResourceMapping } from '@prisma/client';
import { BulkPlanRow, EnvName, PathConflictReport } from '@nwm/core';
import { CurrentEnvResult, EnvSwitcherService, MarkEnvResult, SwitchPreview } from './env-switcher.service';
import { DuplicatePreview, DuplicateResult, EnvDuplicatorService } from './env-duplicator.service';
import { BulkEnvPlanInput, BulkEnvPlanService } from './bulk-env-plan.service';
import {
  GroupDuplicatePreview,
  GroupDuplicateResult,
  GroupDuplicatorService,
} from './group-duplicator.service';
import {
  InstancePromoterService,
  PromoteInput,
  PromotePreview,
  PromoteResult,
} from './instance-promoter.service';
import { PromoteDefaults, PromoteDefaultsService } from './promote-defaults.service';
import { PromotionPublishService, PublishRunView } from './promotion-publish.service';
import { AppliedPathFix, WebhookPathFixService } from './webhook-path-fix.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

@ModuleId('env-switcher')
@Controller()
export class EnvSwitcherController {
  constructor(
    private readonly switcher: EnvSwitcherService,
    private readonly duplicator: EnvDuplicatorService,
    private readonly groupDuplicator: GroupDuplicatorService,
    private readonly promoter: InstancePromoterService,
    private readonly promoteDefaults: PromoteDefaultsService,
    private readonly publishRuns: PromotionPublishService,
    private readonly pathFixer: WebhookPathFixService,
    private readonly bulkPlanner: BulkEnvPlanService,
    private readonly prisma: PrismaService,
  ) {}

  // --- Bascule ---

  /** Env courant détecté via les ressources du JSON (un workflow peut être branché dev OU prod). */
  @Get('env-switcher/current-env/:workflowId')
  currentEnv(@Param('workflowId') workflowId: string): Promise<CurrentEnvResult> {
    return this.switcher.detectCurrentEnv(workflowId);
  }

  @Post('env-switcher/preview/:workflowId')
  preview(
    @Param('workflowId') workflowId: string,
    @Body() body: { targetEnv: string },
  ): Promise<SwitchPreview> {
    return this.switcher.preview(workflowId, body.targetEnv);
  }

  @Post('env-switcher/apply/:workflowId')
  apply(
    @Param('workflowId') workflowId: string,
    @Body() body: { targetEnv: string },
  ): Promise<{ applied: number }> {
    return this.switcher.apply(workflowId, body.targetEnv);
  }

  /** Déclare l'env du workflow (tag, et nom suffixé si demandé) sans toucher aux données. */
  @Post('env-switcher/mark/:workflowId')
  markEnv(
    @Param('workflowId') workflowId: string,
    @Body() body: { targetEnv: EnvName; rename?: boolean },
  ): Promise<MarkEnvResult> {
    return this.switcher.markEnv(workflowId, body.targetEnv, body.rename);
  }

  /** Clone le workflow vers l'env cible (ressources basculées, nom suffixé, tag env:x). */
  @Post('env-switcher/duplicate/:workflowId/preview')
  previewDuplicate(
    @Param('workflowId') workflowId: string,
    @Body() body: { targetEnv: EnvName },
  ): Promise<DuplicatePreview> {
    return this.duplicator.previewDuplicate(workflowId, body.targetEnv);
  }

  /** Actions groupées : qui part d'où vers où, famille par famille. Aucune écriture. */
  @Post('env-switcher/bulk/plan')
  bulkPlan(@Body() body: BulkEnvPlanInput): Promise<BulkPlanRow[]> {
    return this.bulkPlanner.plan(body);
  }

  @Post('env-switcher/duplicate/:workflowId')
  duplicate(
    @Param('workflowId') workflowId: string,
    @Body() body: { targetEnv: EnvName; cascade?: boolean; pinNodes?: string[] },
  ): Promise<DuplicateResult> {
    return this.duplicator.duplicateToEnv(workflowId, body.targetEnv, {
      cascade: body.cascade,
      pinNodes: body.pinNodes,
    });
  }

  /** La cible proposée d'emblée : même instance, étape suivante de la chaîne. */
  @Get('env-switcher/promote/:workflowId/defaults')
  promoteDefaultsFor(@Param('workflowId') workflowId: string): Promise<PromoteDefaults> {
    return this.promoteDefaults.defaults(workflowId);
  }

  /** Impact d'une promotion vers une autre instance (crée ou écrase ?), avant confirmation. */
  @Post('env-switcher/promote/:workflowId/preview')
  promotePreview(
    @Param('workflowId') workflowId: string,
    @Body() body: PromoteInput,
  ): Promise<PromotePreview> {
    return this.promoter.preview(workflowId, body);
  }

  /** Promeut le workflow vers une autre instance (dev → prod), ressources basculées. */
  @Post('env-switcher/promote/:workflowId')
  promote(@Param('workflowId') workflowId: string, @Body() body: PromoteInput): Promise<PromoteResult> {
    return this.promoter.promote(workflowId, body);
  }

  // --- Publication comme la source ---

  /** La chaîne en cours ou en pause qui touche ce workflow, source ou cible. */
  @Get('env-switcher/publish-runs')
  async publishRun(@Query('workflowId') workflowId: string): Promise<{ run: PublishRunView | null }> {
    return { run: await this.publishRuns.find(workflowId) };
  }

  @Post('env-switcher/publish-runs/:id/resume')
  resumePublishRun(@Param('id') id: string): Promise<PublishRunView> {
    return this.publishRuns.resume(id);
  }

  @Post('env-switcher/publish-runs/:id/skip')
  skipPublishRun(@Param('id') id: string): Promise<PublishRunView> {
    return this.publishRuns.skip(id);
  }

  @Post('env-switcher/publish-runs/:id/abandon')
  abandonPublishRun(@Param('id') id: string): Promise<PublishRunView> {
    return this.publishRuns.abandon(id);
  }

  /** Points d'entrée qu'une instance se dispute — le rattrapage des copies d'avant. */
  @Get('env-switcher/webhook-paths/:instanceId')
  webhookPathPlan(@Param('instanceId') instanceId: string): Promise<PathConflictReport> {
    return this.pathFixer.plan(instanceId);
  }

  /** Réécrit le path des copies choisies (jamais celui du gardien de l'URL). */
  @Post('env-switcher/webhook-paths/:instanceId')
  fixWebhookPaths(
    @Param('instanceId') instanceId: string,
    @Body() body: { workflowIds: string[] },
  ): Promise<{ results: AppliedPathFix[] }> {
    return this.pathFixer.apply(instanceId, body.workflowIds ?? []);
  }

  /** Ce que la duplication du groupe ferait, membre par membre, avant d'écrire quoi que ce soit. */
  @Post('env-switcher/duplicate-group/:groupId/preview')
  duplicateGroupPreview(
    @Param('groupId') groupId: string,
    @Body() body: { targetEnv: EnvName },
  ): Promise<GroupDuplicatePreview> {
    return this.groupDuplicator.previewGroup(groupId, body.targetEnv);
  }

  /** Clone tous les workflows d'un groupe + re-câble leurs appels internes vers les copies. */
  @Post('env-switcher/duplicate-group/:groupId')
  duplicateGroup(
    @Param('groupId') groupId: string,
    @Body() body: { targetEnv: EnvName; force?: boolean },
  ): Promise<GroupDuplicateResult> {
    return this.groupDuplicator.duplicateGroup(groupId, body.targetEnv, { force: body.force });
  }

  // --- CRUD ResourceMapping (resource Refine "resource-mappings") ---

  @Get('resource-mappings')
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResourceMapping[]> {
    const { orderBy } = toPrismaListArgs(query, 'logicalName', 'asc');
    const mappings = await this.prisma.resourceMapping.findMany({ orderBy });
    return withTotalCount(res, mappings.length, mappings);
  }

  @Get('resource-mappings/:id')
  get(@Param('id') id: string): Promise<ResourceMapping | null> {
    return this.prisma.resourceMapping.findUnique({ where: { id } });
  }

  @Post('resource-mappings')
  create(
    @Body() body: { provider: string; logicalName: string; values: object; labels?: object },
  ): Promise<ResourceMapping> {
    return this.prisma.resourceMapping.create({ data: body });
  }

  @Patch('resource-mappings/:id')
  update(
    @Param('id') id: string,
    @Body() body: Partial<{ provider: string; logicalName: string; values: object; labels: object }>,
  ): Promise<ResourceMapping> {
    return this.prisma.resourceMapping.update({ where: { id }, data: body });
  }

  @Delete('resource-mappings/:id')
  delete(@Param('id') id: string): Promise<ResourceMapping> {
    return this.prisma.resourceMapping.delete({ where: { id } });
  }
}
