import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  N8N_API_PORT,
  N8nApiError,
  N8nApiPort,
  N8nWorkflow,
  PublicationRun,
  PublicationRunStatus,
  PublicationSourceNode,
  PublicationStep,
  PublicationTargetNode,
  abandonPublicationRun,
  checkedCallees,
  detectPublishModel,
  isPublished,
  nextPublicationStep,
  pairCallees,
  planPublicationSteps,
  publicationOrder,
  recordPublishFailure,
  recordPublished,
  resumePublicationRun,
  skipPublicationStep,
  startPublicationRun,
  msg,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';
import { currentLockContext } from '../../infra/workflow-lock/lock-context';

/** Une cible écrite par la promotion : une par étape de chaîne, la dernière est la cible demandée. */
export interface PublishLeg {
  instanceId: string;
  env?: string | null;
  targetN8nId: string;
  localWorkflowId?: string;
}

export interface PublishRunView {
  id: string;
  status: PublicationRunStatus;
  steps: PublicationStep[];
  sourceWorkflowId: string;
  targetWorkflowId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Config = Awaited<ReturnType<InstancesService['getConfig']>>;

/**
 * « Publier comme la source » : une fois la promotion écrite, publie sur la cible ce
 * qui est publié dans la source, appelés d'abord, et s'arrête au premier refus.
 * L'arrêt est une PAUSE persistée : on reprend, on passe l'étape ou on abandonne
 * plus tard, depuis la fiche de l'un ou l'autre exemplaire.
 */
@Injectable()
export class PromotionPublishService {
  private readonly logger = new Logger(PromotionPublishService.name);
  /** Une chaîne ne se déroule qu'une fois à la fois : un double clic sur « Reprendre » publierait deux fois. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  async start(sourceWorkflowId: string, legs: PublishLeg[]): Promise<PublishRunView> {
    const source = await this.prisma.workflow.findUniqueOrThrow({
      where: { id: sourceWorkflowId },
      select: { instanceId: true, externalId: true },
    });
    const sourceConfig = await this.instances.getConfig(source.instanceId);
    const readSource = this.reader(sourceConfig);

    const steps: PublicationStep[] = [];
    for (const leg of legs) {
      const targetConfig = await this.instances.getConfig(leg.instanceId);
      steps.push(...(await this.planLeg(source.externalId, readSource, leg, this.reader(targetConfig))));
    }

    const run = startPublicationRun(steps);
    const row = await this.prisma.promotionPublishRun.create({
      data: {
        sourceWorkflowId,
        targetWorkflowId: legs[legs.length - 1]?.localWorkflowId ?? null,
        status: run.status,
        steps: run.steps as unknown as Prisma.InputJsonValue,
        createdBy: currentLockContext()?.author ?? null,
      },
    });
    return this.advance(row.id);
  }

  async find(workflowId: string): Promise<PublishRunView | null> {
    const row = await this.prisma.promotionPublishRun.findFirst({
      where: {
        OR: [{ sourceWorkflowId: workflowId }, { targetWorkflowId: workflowId }],
        status: { in: ['paused', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toView(row) : null;
  }

  async get(runId: string): Promise<PublishRunView> {
    const row = await this.prisma.promotionPublishRun.findUnique({ where: { id: runId } });
    if (!row) throw new NotFoundException(msg('env.pubRunNotFound'));
    return toView(row);
  }

  /**
   * Rejoue l'étape refusée. Un exemplaire verrouillé passe ici par le garde qui
   * REFUSE (423) plutôt que par celui qui saute : c'est ce qui ouvre la modale de
   * forçage, et la reprise rejouée avec le forçage publie.
   */
  async resume(runId: string): Promise<PublishRunView> {
    const run = await this.load(runId);
    if (run.status !== 'paused') throw new ConflictException(msg('env.pubRunNotPaused'));
    const failed = run.steps.find((step) => step.state === 'failed');
    const localId = failed?.externalId
      ? await this.localIdOf(failed.instanceId, failed.externalId)
      : undefined;
    if (localId) await this.locks.assertWritable(localId);
    await this.save(runId, resumePublicationRun(run));
    return this.advance(runId);
  }

  async skip(runId: string): Promise<PublishRunView> {
    const run = await this.load(runId);
    if (run.status !== 'paused') throw new ConflictException(msg('env.pubRunNotPaused'));
    await this.save(runId, skipPublicationStep(run));
    return this.advance(runId);
  }

  async abandon(runId: string): Promise<PublishRunView> {
    const run = await this.load(runId);
    await this.save(runId, abandonPublicationRun(run));
    return this.get(runId);
  }

  /** Publie les étapes restantes une à une, jusqu'à la fin ou au premier refus. */
  private async advance(runId: string): Promise<PublishRunView> {
    if (this.running.has(runId)) throw new ConflictException(msg('env.pubRunRunning'));
    this.running.add(runId);
    try {
      let run = await this.load(runId);
      const configs = new Map<string, Config>();
      for (let index = nextPublicationStep(run); index !== -1; index = nextPublicationStep(run)) {
        const step = run.steps[index];
        const config = configs.get(step.instanceId) ?? (await this.instances.getConfig(step.instanceId));
        configs.set(step.instanceId, config);
        run = await this.publishStep(run, index, config);
        await this.save(runId, run);
      }
      return this.get(runId);
    } finally {
      this.running.delete(runId);
    }
  }

  private async publishStep(run: PublicationRun, index: number, config: Config): Promise<PublicationRun> {
    const step = run.steps[index];
    const externalId = step.externalId!;
    const localId = await this.localIdOf(step.instanceId, externalId);
    if (localId && !(await this.locks.canWrite(localId))) {
      return recordPublishFailure(run, index, msg('env.pubStepLocked'));
    }
    try {
      // Relu juste avant : une reprise ne doit pas republier ce qu'un humain a publié entre-temps.
      const live = await this.n8n.getWorkflow(config, externalId);
      if (isPublished(live)) return recordPublished(run, index, true);
      if (detectPublishModel(live) === 'direct') await this.n8n.activateWorkflow(config, externalId, true);
      else await this.n8n.publishWorkflow(config, externalId);
      await this.sync.upsertWorkflow(step.instanceId, await this.n8n.getWorkflow(config, externalId));
      this.logger.log(`"${step.name}" published like its source`);
      return recordPublished(run, index);
    } catch (error) {
      this.logger.warn(`Publishing "${step.name}" refused: ${(error as Error).message}`);
      return recordPublishFailure(run, index, refusal(error));
    }
  }

  /**
   * Les étapes d'une cible : l'arbre d'appels de la source, parcouru en même temps
   * que celui de l'exemplaire promu — la promotion n'a réécrit que les ids.
   */
  private async planLeg(
    sourceRootId: string,
    readSource: (id: string) => Promise<N8nWorkflow | undefined>,
    leg: PublishLeg,
    readTarget: (id: string) => Promise<N8nWorkflow | undefined>,
  ): Promise<PublicationStep[]> {
    const sources = new Map<string, PublicationSourceNode>();
    const targets = new Map<string, PublicationTargetNode>();
    const visit = async (sourceId: string, targetId: string | undefined): Promise<void> => {
      if (sources.has(sourceId)) return;
      const source = await readSource(sourceId);
      if (!source) return;
      sources.set(sourceId, {
        id: sourceId,
        name: source.name,
        published: isPublished(source),
        callees: checkedCallees(source),
      });
      const target = targetId ? await readTarget(targetId) : undefined;
      if (target && targetId) {
        targets.set(sourceId, {
          externalId: targetId,
          name: target.name,
          published: isPublished(target),
          archived: target.isArchived === true,
        });
      }
      for (const pair of pairCallees(source, target)) await visit(pair.source, pair.target);
    };
    await visit(sourceRootId, leg.targetN8nId);
    const order = publicationOrder(sourceRootId, (id) => sources.get(id));
    return planPublicationSteps(order, (id) => targets.get(id), leg);
  }

  private reader(config: Config): (id: string) => Promise<N8nWorkflow | undefined> {
    const cache = new Map<string, Promise<N8nWorkflow | undefined>>();
    return (id) => {
      if (!cache.has(id))
        cache.set(
          id,
          this.n8n.getWorkflow(config, id).catch(() => undefined),
        );
      return cache.get(id)!;
    };
  }

  private async localIdOf(instanceId: string, externalId: string): Promise<string | undefined> {
    const row = await this.prisma.workflow.findUnique({
      where: { instanceId_externalId: { instanceId, externalId } },
      select: { id: true },
    });
    return row?.id;
  }

  private async load(runId: string): Promise<PublicationRun> {
    const view = await this.get(runId);
    return { status: view.status, steps: view.steps };
  }

  private async save(runId: string, run: PublicationRun): Promise<void> {
    await this.prisma.promotionPublishRun.update({
      where: { id: runId },
      data: { status: run.status, steps: run.steps as unknown as Prisma.InputJsonValue },
    });
  }
}

function toView(row: {
  id: string;
  status: string;
  steps: Prisma.JsonValue;
  sourceWorkflowId: string;
  targetWorkflowId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PublishRunView {
  return {
    id: row.id,
    status: row.status as PublicationRunStatus,
    steps: row.steps as unknown as PublicationStep[],
    sourceWorkflowId: row.sourceWorkflowId,
    targetWorkflowId: row.targetWorkflowId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Le refus de n8n tel qu'il le dit, sans l'enveloppe de la requête ni son JSON. */
function refusal(error: unknown): string {
  const message = (error as Error).message ?? String(error);
  if (!(error instanceof N8nApiError)) return message;
  const body = message.replace(/^n8n API [A-Z]+ \S+ → \d+:\s*/, '').trim();
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') detail = parsed.message;
  } catch {
    // Pas du JSON : le texte tel quel.
  }
  return msg('env.pubN8nRefused', {
    status: error.status,
    detail: detail.slice(0, 400) || msg('env.pubNoDetail'),
  });
}
