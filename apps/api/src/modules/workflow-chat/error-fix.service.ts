import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    if (!group) throw new NotFoundException(`Groupe d'erreurs ${groupId} introuvable`);
    if (!group.workflowId) {
      throw new BadRequestException('Workflow non synchronisé dans la plateforme : rien à éditer ici.');
    }

    const session = await this.chat.createSession(group.workflowId);
    await this.prisma.workflowChatSession.update({
      where: { id: session.id },
      data: { title: `Correctif : ${group.pattern}`.slice(0, TITLE_MAX) },
    });

    const result = await this.chat.sendMessage(session.id, buildFixRequest(group), {
      focusNodes: group.failedNode ? [group.failedNode] : [],
    });
    return {
      workflowId: group.workflowId,
      sessionId: session.id,
      proposalId: result.proposalId,
      // Le tour peut avoir été arrêté depuis le tiroir : il n'a alors rien écrit.
      reply: result.assistantMessage?.content ?? 'Le tour a été arrêté avant toute réponse.',
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
    .map((row) => {
      const stack = row.stack ? `\n  stack (début) : ${row.stack.slice(0, 400)}` : '';
      return `- ${row.startedAt.toISOString()} : ${row.message ?? '(sans message)'}${stack}`;
    })
    .join('\n');

  return [
    `Ce workflow échoue en production, et je veux un correctif.`,
    ``,
    `Problème (regroupé par la plateforme) :`,
    `- nœud fautif : ${group.failedNode ?? 'inconnu'}${group.failedNodeType ? ` (${group.failedNodeType})` : ''}`,
    `- forme du message : ${group.pattern}`,
    `- catégorie : ${group.category}`,
    `- ${group.occurrences} occurrence(s) entre ${group.firstSeenAt.toISOString()} et ${group.lastSeenAt.toISOString()}`,
    ...(group.regressions > 0
      ? [`- déjà marqué corrigé ${group.regressions} fois : le problème revient, cherche la cause de fond`]
      : []),
    ``,
    `Dernières occurrences réelles :`,
    samples || '- (détail purgé par n8n)',
    ``,
    `Propose la modification MINIMALE qui corrige la cause, ou à défaut qui rend le workflow`,
    `robuste à cet échec (retry, garde sur les données, sortie d'erreur branchée) sans le masquer.`,
    `Si le vrai correctif est hors du workflow (credential expiré, quota du provider, données`,
    `côté système tiers), dis-le clairement et ne propose PAS de modification.`,
  ].join('\n');
}
