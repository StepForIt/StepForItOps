import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  isBlankWorkflow,
  n8nWorkflowUrl,
  subWorkflowCalls,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { InstancesService } from '../instances/instances.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/** Un sous-workflow créé par l'assistant, resté vide et que personne n'appelle. */
export interface ChatLeftover {
  workflowId: string;
  externalId: string;
  name: string;
  createdAt: Date;
  /** La conversation qui l'a demandé, quand elle existe encore. */
  sessionId: string | null;
  /** Le workflow depuis lequel la découpe avait été demandée. */
  parentWorkflowId: string | null;
  url: string;
}

/**
 * Les sous-workflows que l'assistant a créés et que rien n'est venu remplir.
 *
 * `create_sub_workflow` écrit dans n8n avant la revue — c'est la seule façon
 * d'avoir l'id sur lequel pointera le nœud d'appel. Refuser la proposition
 * laissait donc un workflow vide dans la liste, sans que rien ne dise d'où il
 * venait ni qu'on pouvait le jeter.
 *
 * Le verdict est RECALCULÉ, jamais posé au refus : un drapeau « à supprimer »
 * mentirait dès que quelqu'un adopte le workflow entre-temps, et c'est le genre
 * de mensonge qui finit par faire supprimer un workflow qui servait. Ce qu'on
 * garde en base est la seule chose qui ne se déduit pas — la PROVENANCE.
 */
@Injectable()
export class ChatLeftoversService {
  private readonly logger = new Logger(ChatLeftoversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Retient d'où vient un workflow que l'assistant vient de créer. */
  async record(input: {
    workflowId: string;
    sessionId: string | null;
    parentWorkflowId: string;
  }): Promise<void> {
    try {
      await this.prisma.workflowChatCreation.create({
        data: {
          workflowId: input.workflowId,
          sessionId: input.sessionId,
          parentWorkflowId: input.parentWorkflowId,
        },
      });
    } catch (error) {
      // La provenance est un confort de ménage : la perdre ne doit pas faire
      // échouer le tour, qui a déjà créé le workflow dans n8n.
      this.logger.warn(`Provenance non enregistrée (${input.workflowId}) : ${(error as Error).message}`);
    }
  }

  /**
   * Les restes, pour un workflow appelant donné (ou pour tout le parc).
   *
   * Deux conditions, lues sur l'état RÉEL : le workflow n'a toujours que son
   * déclencheur, et aucun workflow de l'instance ne l'appelle. La seconde compte
   * autant que la première — un sous-workflow encore vide mais déjà câblé est un
   * chantier en cours, pas un reste.
   */
  async list(filter: { parentWorkflowId?: string; sessionId?: string } = {}): Promise<ChatLeftover[]> {
    const creations = await this.prisma.workflowChatCreation.findMany({
      where: {
        ...(filter.parentWorkflowId ? { parentWorkflowId: filter.parentWorkflowId } : {}),
        ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
        // Un workflow que n8n ne connaît plus n'a rien à faire supprimer.
        workflow: { missingUpstreamAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        workflow: { select: { id: true, externalId: true, name: true, raw: true, instanceId: true } },
      },
    });
    if (creations.length === 0) return [];

    const leftovers: ChatLeftover[] = [];
    // Les appelants sont cherchés par instance, une seule fois : un reste et son
    // voisin viennent presque toujours de la même.
    const callersByInstance = new Map<string, Set<string>>();
    for (const creation of creations) {
      if (!isBlankWorkflow(creation.workflow.raw as unknown as N8nWorkflow)) continue;
      const called = await this.calledIds(creation.workflow.instanceId, callersByInstance);
      if (called.has(creation.workflow.externalId)) continue;
      const instance = await this.instances.getConfig(creation.workflow.instanceId);
      leftovers.push({
        workflowId: creation.workflow.id,
        externalId: creation.workflow.externalId,
        name: creation.workflow.name,
        createdAt: creation.createdAt,
        sessionId: creation.sessionId,
        parentWorkflowId: creation.parentWorkflowId,
        url: n8nWorkflowUrl(instance.baseUrl, creation.workflow.externalId),
      });
    }
    return leftovers;
  }

  /**
   * Ids n8n appelés par au moins un workflow de l'instance, lus à la volée dans
   * `Workflow.raw` comme le fait la carte des workflows : il n'y a pas de graphe
   * persisté, et en tenir un pour cette seule question coûterait plus cher que
   * de le relire quand on en a besoin.
   */
  private async calledIds(instanceId: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
    const known = cache.get(instanceId);
    if (known) return known;
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, missingUpstreamAt: null },
      select: { raw: true },
    });
    const called = new Set<string>();
    for (const workflow of workflows) {
      for (const call of subWorkflowCalls(workflow.raw as unknown as N8nWorkflow))
        called.add(call.externalId);
    }
    cache.set(instanceId, called);
    return called;
  }

  /**
   * Supprime un reste dans n8n. Le verdict est REVÉRIFIÉ ici : cette route prend
   * un id de workflow, elle ne doit pouvoir effacer que ce que l'assistant a créé
   * et que personne n'a adopté depuis — y compris entre l'affichage de la liste
   * et le clic.
   */
  async remove(workflowId: string): Promise<{ ok: true }> {
    const leftover = (await this.list()).find((entry) => entry.workflowId === workflowId);
    if (!leftover) {
      throw new BadRequestException(
        "Ce workflow n'est plus un reste : soit il n'a pas été créé par l'assistant, soit il " +
          "porte désormais des nœuds ou se fait appeler. Rien n'a été supprimé.",
      );
    }
    await this.locks.assertWritable(workflowId);
    const { workflow } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    await this.n8n.deleteWorkflow(config, workflow.externalId);
    // La ligne locale est GARDÉE et estampillée, comme tout workflow disparu de
    // n8n : la supprimer emporterait par cascade les propositions qui la citent,
    // et le refus qu'on vient d'archiver perdrait la moitié de son diff.
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { missingUpstreamAt: new Date() },
    });
    this.logger.log(`Sous-workflow vide « ${workflow.name} » supprimé dans n8n (${workflow.externalId})`);
    return { ok: true };
  }
}
