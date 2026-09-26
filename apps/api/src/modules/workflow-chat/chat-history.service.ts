import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChatExportService } from './chat-export.service';

/** Une conversation passée, telle que l'assistant la voit dans la liste. */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: Date;
  messages: number;
  /** Résumés des modifications proposées et ce qu'elles sont devenues. */
  proposals: Array<{ summary: string; status: string }>;
}

/**
 * Caractères rendus d'une conversation relue. Une conversation de trente tours
 * remplirait le contexte à elle seule et chasserait le workflow qu'on examine :
 * on coupe, et on le dit, plutôt que de laisser le modèle croire qu'il a tout lu.
 */
const MAX_CHARS = 12_000;

/**
 * Les conversations passées d'un workflow, relues par l'assistant.
 *
 * Ce qu'on a expliqué mardi dans un autre fil n'est nulle part ailleurs : ni dans
 * le JSON n8n, ni dans l'historique du fil courant, qui est borné. Sans ça,
 * l'utilisateur réexplique — ou pire, ne réexplique pas et l'assistant repart de zéro.
 */
@Injectable()
export class ChatHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exporter: ChatExportService,
  ) {}

  /** Conversations du workflow, la plus récente d'abord, hors celle en cours. */
  async list(workflowId: string, exceptSessionId?: string): Promise<ConversationSummary[]> {
    const sessions = await this.prisma.workflowChatSession.findMany({
      where: { workflowId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        proposals: { select: { summary: true, status: true } },
      },
    });
    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messages: session._count.messages,
      proposals: session.proposals,
    }));
  }

  /**
   * Une conversation en Markdown. Le workflow est vérifié et non déduit : un id
   * de session venu du modèle ne doit jamais ouvrir le fil d'un autre workflow.
   */
  async read(workflowId: string, sessionId: string): Promise<string> {
    const session = await this.prisma.workflowChatSession.findUnique({
      where: { id: sessionId },
      select: { workflowId: true },
    });
    if (!session) throw new NotFoundException(`Conversation ${sessionId} not found`);
    if (session.workflowId !== workflowId) {
      throw new ForbiddenException('This conversation belongs to another workflow');
    }

    const { markdown } = await this.exporter.exportSession(sessionId);
    if (markdown.length <= MAX_CHARS) return markdown;
    return (
      `${markdown.slice(0, MAX_CHARS)}\n\n` +
      `[…] Conversation truncated (${markdown.length} characters, ${MAX_CHARS} returned). ` +
      `The end is missing: do not conclude from its absence that nothing happened there.`
    );
  }
}
