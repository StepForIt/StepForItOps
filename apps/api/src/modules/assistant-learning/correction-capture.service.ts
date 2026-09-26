import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  EVENTS,
  N8nWorkflow,
  VersionCreatedEvent,
  WorkflowEditOperation,
  correctionQuestion,
  isWithinCorrectionWindow,
  readCorrection,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { ASSISTANT_LEARNING_MANIFEST } from './manifest';
import { LessonDistillService } from './lesson-distill.service';

/**
 * Apparie ce que l'assistant a écrit à ce que l'humain a laissé, et en tire ce
 * qu'il y a à apprendre.
 *
 * Le déclencheur est `version.created` : chaque snapshot de `versioning` est un
 * état du workflow tel que n8n le sert. Quand le snapshot précédent était une
 * écriture de l'assistant, le diff des deux n'est pas un diff ordinaire — c'est
 * une copie rendue avec la correction à côté.
 *
 * Trois garde-fous, tous nécessaires, aucun suffisant :
 *  - la FENÊTRE (six heures) : au-delà, la correction n'est plus imputable ;
 *  - l'UNICITÉ : une proposition ne se lit qu'une fois (`proposalId` unique), et
 *    une proposition appliquée APRÈS coup annule la lecture — ce qu'on lirait
 *    serait le travail de l'humain, pas la correction de l'assistant ;
 *  - le PÉRIMÈTRE : seuls les nœuds que la proposition a touchés.
 *
 * Lectures directes des tables de `workflow-chat` et de `versioning`, jamais
 * leurs services : ce sont des modules métier désactivables (même précédent que
 * `restore-point.service.ts`, qui lit `WorkflowVersion` sans importer `versioning`).
 */
@Injectable()
export class CorrectionCaptureService {
  private readonly logger = new Logger(CorrectionCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly distill: LessonDistillService,
  ) {}

  @OnEvent(EVENTS.versionCreated)
  async onVersionCreated(event: VersionCreatedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(ASSISTANT_LEARNING_MANIFEST.id))) return;
    try {
      await this.capture(event);
    } catch (error) {
      // Apprendre est un bonus : un échec ici ne doit jamais remonter dans la
      // synchro qui a émis l'événement.
      this.logger.warn(`Could not read correction (${event.workflowId}): ${(error as Error).message}`);
    }
  }

  private async capture(event: VersionCreatedEvent): Promise<void> {
    const version = await this.prisma.workflowVersion.findUnique({ where: { id: event.versionId } });
    if (!version) return;

    // La dernière écriture de l'assistant sur ce workflow.
    const proposal = await this.prisma.workflowChatProposal.findFirst({
      where: { workflowId: event.workflowId, status: 'applied', appliedAt: { not: null } },
      orderBy: { appliedAt: 'desc' },
    });
    if (!proposal?.appliedAt) return;

    // Déjà lue : la deuxième lecture porterait sur ce que l'humain a fait ensuite.
    const seen = await this.prisma.assistantCorrection.findUnique({ where: { proposalId: proposal.id } });
    if (seen) return;

    if (!isWithinCorrectionWindow(proposal.appliedAt, version.createdAt)) return;

    // Le snapshot que l'application a elle-même produit n'est pas une correction :
    // c'est l'écriture de l'assistant qui revient de n8n. On l'écarte au contenu
    // et non à la date — n8n normalise le JSON, mais le hash de la plateforme est
    // calculé sur ce qu'il rend, donc l'égalité stricte suffit à le reconnaître.
    const wrote = proposal.raw as unknown as N8nWorkflow;
    const fixed = version.raw as unknown as N8nWorkflow;
    const reading = readCorrection({
      wrote,
      fixed,
      touchedNodes: touchedNodes(proposal.operations as unknown as WorkflowEditOperation[]),
      touchedConnections: touchesConnections(proposal.operations as unknown as WorkflowEditOperation[]),
    });

    if (reading.changes.length === 0) return;

    const question = correctionQuestion(reading);
    await this.prisma.assistantCorrection.create({
      data: {
        workflowId: event.workflowId,
        proposalId: proposal.id,
        versionId: version.id,
        changes: reading.changes as unknown as object,
        question,
        // Sans question, il n'y a rien à attendre de l'humain : la correction est
        // close dès que ses leçons sont distillées.
        status: question ? 'pending' : 'resolved',
      },
    });

    this.logger.log(
      `Human correction read on ${event.workflowName}: ` +
        `${reading.lessons.length} lesson(s), ${reading.questions.length} question(s).`,
    );

    if (reading.lessons.length > 0) {
      await this.distill.fromCorrection(event.workflowId, reading.lessons);
    }
  }
}

/**
 * Les nœuds qu'une proposition a touchés, lus dans ses opérations.
 *
 * C'est ce qui borne le soupçon : hors de ces nœuds, ce que l'humain a changé
 * n'a jamais été écrit par l'assistant.
 */
function touchedNodes(operations: WorkflowEditOperation[]): string[] {
  const names = new Set<string>();
  for (const operation of operations ?? []) {
    const candidate = operation as unknown as Record<string, unknown>;
    for (const key of ['node', 'newName', 'from', 'to', 'after', 'before']) {
      const value = candidate[key];
      if (typeof value === 'string') names.add(value);
    }
    // `add-node` porte le nœud entier, pas son nom.
    const added = candidate.node;
    if (added && typeof added === 'object' && 'name' in added) {
      const name = (added as { name?: unknown }).name;
      if (typeof name === 'string') names.add(name);
    }
  }
  return [...names];
}

/** La proposition touchait-elle au câblage ? Sinon un câblage refait n'est pas sa faute. */
function touchesConnections(operations: WorkflowEditOperation[]): boolean {
  const wiring = new Set(['connect', 'disconnect', 'add-node', 'remove-node', 'rename-node']);
  return (operations ?? []).some((operation) => wiring.has((operation as { op: string }).op));
}
