import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ChatExportSession,
  ChatExportWorkflow,
  chatExportFilename,
  chatSessionToMarkdown,
  chatSessionsToMarkdown,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Fichier Markdown prêt à télécharger : le front n'a plus qu'à le poser sur le disque. */
export interface ChatExport {
  filename: string;
  markdown: string;
}

@Injectable()
export class ChatExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les propositions vivent à côté des messages (une réponse ne porte que son id) : on les
   * relit en bloc pour dire, dans l'export, ce qu'est devenue chaque modification proposée.
   */
  private async proposalsOf(sessionId: string): Promise<Map<string, { summary: string; status: string }>> {
    const proposals = await this.prisma.workflowChatProposal.findMany({
      where: { sessionId },
      select: { id: true, summary: true, status: true },
    });
    return new Map(proposals.map((item) => [item.id, { summary: item.summary, status: item.status }]));
  }

  private async load(sessionId: string): Promise<ChatExportSession> {
    const session = await this.prisma.workflowChatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: { select: { id: true, name: true } } },
        },
      },
    });
    if (!session) throw new NotFoundException(`Conversation ${sessionId} introuvable`);
    const proposals = await this.proposalsOf(session.id);
    return {
      title: session.title,
      createdAt: session.createdAt,
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        proposal: message.proposalId ? (proposals.get(message.proposalId) ?? null) : null,
        attachments: message.attachments.filter((attachment) => !attachment.name).length,
        files: message.attachments
          .map((attachment) => attachment.name)
          .filter((name): name is string => Boolean(name)),
      })),
    };
  }

  private async workflowOf(workflowId: string): Promise<ChatExportWorkflow> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { instance: { select: { name: true } } },
    });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} introuvable`);
    return { name: workflow.name, instanceName: workflow.instance.name };
  }

  async exportSession(sessionId: string): Promise<ChatExport> {
    const session = await this.prisma.workflowChatSession.findUnique({
      where: { id: sessionId },
      select: { workflowId: true, title: true },
    });
    if (!session) throw new NotFoundException(`Conversation ${sessionId} introuvable`);
    const workflow = await this.workflowOf(session.workflowId);
    return {
      filename: chatExportFilename(`${workflow.name} ${session.title}`),
      markdown: chatSessionToMarkdown(workflow, await this.load(sessionId)),
    };
  }

  async exportWorkflow(workflowId: string): Promise<ChatExport> {
    const workflow = await this.workflowOf(workflowId);
    const sessions = await this.prisma.workflowChatSession.findMany({
      where: { workflowId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const loaded: ChatExportSession[] = [];
    for (const item of sessions) loaded.push(await this.load(item.id));
    return {
      filename: chatExportFilename(`conversations ${workflow.name}`),
      markdown: chatSessionsToMarkdown(workflow, loaded),
    };
  }
}
