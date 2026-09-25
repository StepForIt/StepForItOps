import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { N8N_API_PORT, N8nApiError, N8nApiPort, detectPublishModel } from '@nwm/core';
import { WorkflowsService } from './workflows.service';
import { WorkflowSyncService } from './workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { isN8nAuthRefusal, n8nAuthRefused } from '../../common/filters/n8n-error.mapper';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/** Ce que la publication a donné, du point de vue de celui qui a cliqué. */
export interface PublishResult {
  ok: true;
  /** Déjà publié avant l'appel : `updateWorkflow` republie de lui-même, rien n'a été fait. */
  alreadyPublished: boolean;
}

/**
 * Publier un workflow sur une instance n8n 2.x.
 *
 * Publier, c'est mettre en production : le geste reste explicite, jamais un effet
 * de bord d'une écriture. C'est pour ça qu'il vit ici et non dans l'application
 * d'une proposition — publier n'a rien de propre à une modification de l'assistant,
 * et un workflow bâti à la main a le même besoin.
 */
@Injectable()
export class WorkflowPublishService {
  private readonly logger = new Logger(WorkflowPublishService.name);

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  async publish(workflowId: string): Promise<PublishResult> {
    // Relu depuis n8n : l'état de publication est précisément ce que la copie
    // locale peut avoir raté, et c'est lui qui décide s'il y a quelque chose à faire.
    const { workflow, raw, missing } = await this.workflows.getFreshRaw(workflowId);
    if (missing) throw new BadRequestException('n8n ne connaît plus ce workflow.');
    if (workflow.archived) {
      throw new BadRequestException('Workflow archivé côté n8n : la publication est refusée.');
    }

    const model = detectPublishModel(raw);
    if (model === 'direct') {
      throw new BadRequestException(
        'Cette instance n8n ne publie pas par versions : un workflow y est simplement actif ou non, ' +
          'et l’écriture suffit. Il n’y a rien à publier.',
      );
    }
    if (model === 'versioned-published') return { ok: true, alreadyPublished: true };

    await this.locks.assertWritable(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    try {
      await this.n8n.publishWorkflow(config, workflow.externalId);
    } catch (error) {
      throw this.publishRefused(error, workflow.name);
    }

    // La publication change `activeVersionId` et l'état actif : sans resynchro, la
    // plateforme continuerait d'afficher un workflow non publié qui tourne.
    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);
    this.logger.log(`Workflow « ${workflow.name} » publié`);
    return { ok: true, alreadyPublished: false };
  }

  /**
   * n8n refuse la publication pour des raisons qui se corrigent, pas des pannes :
   * une revue de workflow ouverte, un chemin de webhook déjà pris. Rendues en 500
   * « Internal server error », elles n'apprenaient ni laquelle, ni quoi faire.
   */
  private publishRefused(error: unknown, workflowName: string): Error {
    if (!(error instanceof N8nApiError)) return error as Error;
    if (isN8nAuthRefusal(error)) return n8nAuthRefused(error);

    const detail = error.message
      .replace(/^n8n API [A-Z]+ \S+ → \d+:\s*/, '')
      .slice(0, 400)
      .trim();
    if (error.status === 404) {
      return new BadRequestException(
        `Cette instance n8n ne connaît pas la publication par versions (route /publish absente) : ` +
          `elle est trop ancienne, ou « ${workflowName} » a disparu.`,
      );
    }
    if (error.status === 409) {
      return new ConflictException(
        `n8n refuse de publier « ${workflowName} » : soit une revue de workflow est en cours, ` +
          `soit un chemin de webhook est déjà pris par un autre workflow. ` +
          `Ce qu'il répond : ${detail || '(aucun détail)'}`,
      );
    }
    return new BadRequestException(
      `n8n a refusé de publier « ${workflowName} » (erreur ${error.status}). ` +
        `Le workflow reste en brouillon. Ce qu'il répond : ${detail || '(aucun détail)'}`,
    );
  }
}
