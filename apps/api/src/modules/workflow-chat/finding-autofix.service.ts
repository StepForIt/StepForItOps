import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkflowEditOperation, applyEditOperations, autoFixOperations, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { ProposalService } from './proposal.service';

export interface FindingAutoFixResult {
  workflowId: string;
  proposalId: string;
  /** Findings demandés que l'état actuel du workflow ne permet plus de corriger seul. */
  skipped: number;
}

/**
 * Le jumeau sans IA de `FindingFixService`, pour les findings dont la règle sait
 * écrire le correctif (`autoFixOperations`). Seule la RÉDACTION change : la
 * proposition créée est ordinaire — même revue en diff, même porte, même
 * écriture gardée (verrou, chaîne d'env, point de retour).
 */
@Injectable()
export class FindingAutoFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly proposals: ProposalService,
  ) {}

  async propose(findingIds: string[]): Promise<FindingAutoFixResult> {
    if (findingIds.length === 0) throw new BadRequestException(msg('chat.findingFixNone'));
    const findings = await this.prisma.finding.findMany({ where: { id: { in: findingIds } } });
    if (findings.length === 0) throw new NotFoundException(msg('chat.findingFixNotFound'));
    const workflowId = findings[0]!.workflowId;
    if (findings.some((finding) => finding.workflowId !== workflowId)) {
      throw new BadRequestException(msg('chat.findingFixSameWorkflow'));
    }

    // Recalculé sur n8n tel qu'il est maintenant, correctif après correctif : deux
    // renommages sur un même nœud réécrivent ses paramètres, le second doit partir
    // de ce qu'a laissé le premier.
    const { raw } = await this.workflows.getFreshRaw(workflowId);
    let current = raw;
    const operations: WorkflowEditOperation[] = [];
    const fixed: string[] = [];
    for (const finding of findings) {
      const ops = autoFixOperations(current, {
        code: finding.code,
        nodeName: finding.nodeName ?? undefined,
        data: (finding.data ?? undefined) as Record<string, unknown> | undefined,
      });
      if (!ops) continue;
      current = applyEditOperations(current, ops).workflow;
      operations.push(...ops);
      fixed.push(finding.message);
    }
    if (operations.length === 0) {
      throw new UnprocessableEntityException(msg('chat.autofixStale'));
    }

    const { proposal } = await this.proposals.create(workflowId, null, summaryOf(fixed), operations);
    return { workflowId, proposalId: proposal.id, skipped: findings.length - fixed.length };
  }
}

function summaryOf(messages: string[]): string {
  return [msg('chat.autofixSummary'), ...messages.map((message) => `- ${message}`)].join('\n');
}
