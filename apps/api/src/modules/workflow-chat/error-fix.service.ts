import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChatService } from './chat.service';

/** Occurrences récentes jointes au contexte : assez pour voir le motif, pas le roman. */
const SAMPLE_OCCURRENCES = 5;
const TITLE_MAX = 60;

export interface ErrorFixResult {
  workflowId: string;
  sessionId: string;
  /** null si l'IA a répondu sans proposer de modification (pas de correctif sûr). */
  proposalId: string | null;
  reply: string;
}

/**
 * Pont erreurs → assistant : un problème (ErrorGroup) devient une conversation
 * pré-alimentée avec son contexte, et l'IA répond par une proposition d'édition —
 * revue en diff avant tout PUT vers n8n, comme n'importe quelle proposition du chat.
 * Le groupe est lu directement en base : pas d'import du service d'un autre module.
 */
@Injectable()
export class ErrorFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  async proposeFix(groupId: string): Promise<ErrorFixResult> {
    const group = await this.prisma.errorGroup.findUnique({
      where: { id: groupId },
      include: { errors: { orderBy: { startedAt: 'desc' }, take: SAMPLE_OCCURRENCES } },
    });
    if (!group) throw new NotFoundException(msg('chat.errorFixGroupNotFound', { id: groupId }));
    if (!group.workflowId) {
      throw new BadRequestException(msg('chat.errorFixNoWorkflow'));
    }

    const session = await this.chat.createSession(group.workflowId);
    await this.prisma.workflowChatSession.update({
      where: { id: session.id },
      data: { title: msg('chat.fixTitle', { subject: group.pattern }).slice(0, TITLE_MAX) },
    });

    const result = await this.chat.sendMessage(session.id, buildFixRequest(group), {
      focusNodes: group.failedNode ? [group.failedNode] : [],
    });
    return {
      workflowId: group.workflowId,
      sessionId: session.id,
      proposalId: result.proposalId,
      // Le tour peut avoir été arrêté depuis le tiroir : il n'a alors rien écrit.
      reply: result.assistantMessage?.content ?? msg('chat.turnStoppedNoReply'),
    };
  }
}

interface GroupWithErrors {
  workflowName: string;
  failedNode: string | null;
  failedNodeType: string | null;
  pattern: string;
  category: string;
  occurrences: number;
  regressions: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  errors: Array<{ startedAt: Date; message: string | null; stack: string | null }>;
}

function buildFixRequest(group: GroupWithErrors): string {
  const samples = group.errors
    .map((row) =>
      msg('chat.errorFixSample', {
        at: row.startedAt.toISOString(),
        message: row.message ?? msg('chat.errorFixNoMessage'),
        stack: row.stack ? msg('chat.errorFixSampleStack', { stack: row.stack.slice(0, 400) }) : '',
      }),
    )
    .join('\n');

  return msg('chat.errorFixRequest', {
    node: group.failedNode ?? msg('chat.errorFixUnknownNode'),
    nodeType: group.failedNodeType ? ` (${group.failedNodeType})` : '',
    pattern: group.pattern,
    category: group.category,
    count: group.occurrences,
    first: group.firstSeenAt.toISOString(),
    last: group.lastSeenAt.toISOString(),
    regressions: group.regressions,
    samples: samples || msg('chat.errorFixPurged'),
  });
}
