import { Body, Controller, Delete, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ChatFileInput, ChatImageInput, TurnProgress } from '@nwm/core';
import { WorkflowChatMemory, WorkflowChatProposal, WorkflowChatSession } from '@prisma/client';
import { ChatService, SendMessageResult, SessionSummary, SessionWithMessages } from './chat.service';
import { ApplyResult, ProposalReview, ProposalService } from './proposal.service';
import { ErrorFixResult, ErrorFixService } from './error-fix.service';
import { FindingFixResult, FindingFixService } from './finding-fix.service';
import { FindingAutoFixResult, FindingAutoFixService } from './finding-autofix.service';
import { ChatExport, ChatExportService } from './chat-export.service';
import { ChatMemoryService } from './chat-memory.service';
import { ChatProgressService } from './chat-progress.service';
import { ChatCancelService } from './chat-cancel.service';
import { ChatCompletionSources, ChatSuggestionsService } from './chat-suggestions.service';
import { ChatLeftover, ChatLeftoversService } from './chat-leftovers.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('workflow-chat')
@Controller('workflow-chat')
export class WorkflowChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly proposals: ProposalService,
    private readonly errorFix: ErrorFixService,
    private readonly findingFix: FindingFixService,
    private readonly findingAutoFix: FindingAutoFixService,
    private readonly chatExport: ChatExportService,
    private readonly memory: ChatMemoryService,
    private readonly progress: ChatProgressService,
    private readonly cancels: ChatCancelService,
    private readonly suggestions: ChatSuggestionsService,
    private readonly leftovers: ChatLeftoversService,
  ) {}

  /**
   * Les sous-workflows que l'assistant a créés pour ce workflow et que rien n'est
   * venu remplir. `create_sub_workflow` écrit dans n8n avant la revue — c'est la
   * seule façon d'avoir l'id sur lequel pointera le nœud d'appel —, donc une
   * proposition refusée laisse un workflow vide que rien ne signalait.
   */
  @Get('workflows/:workflowId/leftovers')
  listLeftovers(@Param('workflowId') workflowId: string): Promise<ChatLeftover[]> {
    return this.leftovers.list({ parentWorkflowId: workflowId });
  }

  /** Supprime un de ces restes dans n8n. Le verdict est revérifié côté API. */
  @Delete('leftovers/:workflowId')
  deleteLeftover(@Param('workflowId') workflowId: string): Promise<{ ok: true }> {
    return this.leftovers.remove(workflowId);
  }

  /**
   * Ce que l'assistant garde de ce workflow. Exposé en lecture ET en écriture :
   * une mémoire qu'on ne peut ni relire ni corriger est un passif — un fait faux
   * s'y répéterait à chaque conversation sans qu'on sache d'où il vient.
   */
  @Get('workflows/:workflowId/memory')
  listMemory(@Param('workflowId') workflowId: string): Promise<WorkflowChatMemory[]> {
    return this.memory.list(workflowId);
  }

  @Post('workflows/:workflowId/memory')
  remember(
    @Param('workflowId') workflowId: string,
    @Body() body: { content: string },
  ): Promise<{ stored: boolean; reason?: string }> {
    return this.memory.remember(workflowId, body?.content, null);
  }

  @Delete('memory/:memoryId')
  forget(@Param('memoryId') memoryId: string): Promise<{ ok: true }> {
    return this.memory.forget(memoryId);
  }

  /** Un problème (ErrorGroup) → une conversation pré-alimentée + proposition de correctif IA. */
  @Post('error-fix/:groupId')
  proposeFix(@Param('groupId') groupId: string): Promise<ErrorFixResult> {
    return this.errorFix.proposeFix(groupId);
  }

  /** Un ou plusieurs findings d'un même workflow → proposition de correctif IA. */
  @Post('finding-fix')
  proposeFindingFix(@Body() body: { findingIds: string[] }): Promise<FindingFixResult> {
    return this.findingFix.proposeFix(body?.findingIds ?? []);
  }

  /** Findings que la règle sait corriger seule → proposition revue en diff, sans appel IA. */
  @Post('finding-autofix')
  proposeFindingAutoFix(@Body() body: { findingIds: string[] }): Promise<FindingAutoFixResult> {
    return this.findingAutoFix.propose(body?.findingIds ?? []);
  }

  @Get('workflows/:workflowId/sessions')
  listSessions(@Param('workflowId') workflowId: string): Promise<SessionSummary[]> {
    return this.chat.listSessions(workflowId);
  }

  @Post('workflows/:workflowId/sessions')
  createSession(@Param('workflowId') workflowId: string): Promise<WorkflowChatSession> {
    return this.chat.createSession(workflowId);
  }

  /** Conversation en Markdown, à coller dans un ticket ou à archiver hors plateforme. */
  @Get('sessions/:sessionId/export')
  exportSession(@Param('sessionId') sessionId: string): Promise<ChatExport> {
    return this.chatExport.exportSession(sessionId);
  }

  @Get('workflows/:workflowId/export')
  exportWorkflow(@Param('workflowId') workflowId: string): Promise<ChatExport> {
    return this.chatExport.exportWorkflow(workflowId);
  }

  @Get('sessions/:sessionId')
  getSession(@Param('sessionId') sessionId: string): Promise<SessionWithMessages> {
    return this.chat.getSession(sessionId);
  }

  @Delete('sessions/:sessionId')
  deleteSession(@Param('sessionId') sessionId: string): Promise<{ ok: true }> {
    return this.chat.deleteSession(sessionId);
  }

  /**
   * Rejoue la dernière demande quand rien ne lui a répondu. Le message n'est pas
   * redéposé : c'est le même tour qu'on refait, pas une nouvelle question.
   */
  @Post('sessions/:sessionId/retry')
  retry(@Param('sessionId') sessionId: string): Promise<SendMessageResult> {
    return this.chat.retryLast(sessionId);
  }

  /**
   * Où en est le tour en cours. Interrogé pendant l'attente : l'envoi du message
   * ne rend la main qu'une fois la réponse écrite, il ne peut rien raconter en
   * chemin. Rien en mémoire ⇒ `null`, jamais une 404 : un tour peut aussi bien
   * n'avoir pas encore commencé qu'appartenir à un process redémarré.
   */
  @Get('sessions/:sessionId/progress')
  turnProgress(@Param('sessionId') sessionId: string): TurnProgress | null {
    return this.progress.read(sessionId);
  }

  /**
   * Arrête le tour en cours. La réponse de `POST .../messages`, toujours en
   * attente, revient alors avec la demande défaite : c'est elle qui rend le
   * texte et les captures à la saisie, pas cette route.
   *
   * `stopped: false` quand aucun tour ne tourne DANS CE PROCESS — le tour se
   * poursuit et répondra ; mieux vaut le dire que laisser croire à un arrêt.
   */
  @Post('sessions/:sessionId/cancel')
  cancel(@Param('sessionId') sessionId: string): { stopped: boolean } {
    return { stopped: this.cancels.cancel(sessionId) };
  }

  /**
   * De quoi compléter la frappe : demandes courantes, celles déjà écrites sur ce
   * workflow, et les noms de ses nœuds. Lu une fois à l'ouverture du tiroir — la
   * complétion elle-même est locale, sans appel par frappe.
   */
  @Get('workflows/:workflowId/completions')
  completions(@Param('workflowId') workflowId: string): Promise<ChatCompletionSources> {
    return this.suggestions.sources(workflowId);
  }

  @Post('sessions/:sessionId/messages')
  sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: { content: string; images?: ChatImageInput[]; files?: ChatFileInput[] },
  ): Promise<SendMessageResult> {
    return this.chat.sendMessage(sessionId, body?.content, { images: body?.images, files: body?.files });
  }

  /**
   * Octets d'une pièce jointe. Servis à part du JSON de la conversation : les
   * images pèsent des Mo, et le navigateur les garde en cache — une pièce jointe
   * ne change jamais après son envoi.
   */
  @Get('attachments/:attachmentId')
  async attachment(
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.chat.getAttachment(attachmentId);
    response.set({
      // Un fichier joint n'est jamais rendu par le navigateur, seulement
      // téléchargé : servir du HTML ou du SVG téléversé sous son vrai type le
      // ferait exécuter sur l'origine de la plateforme.
      'Content-Type': file.name ? 'text/plain; charset=utf-8' : file.mediaType,
      'Content-Length': String(file.data.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...(file.name
        ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` }
        : {}),
    });
    return new StreamableFile(file.data);
  }

  /** Diff complet de la proposition, à revoir avant application. */
  @Get('proposals/:proposalId')
  review(@Param('proposalId') proposalId: string): Promise<ProposalReview> {
    return this.proposals.review(proposalId);
  }

  /** `force` contourne la porte DEV/PROD : une case cochée par un humain, jamais un défaut. */
  @Post('proposals/:proposalId/apply')
  apply(@Param('proposalId') proposalId: string, @Body() body?: { force?: boolean }): Promise<ApplyResult> {
    return this.proposals.apply(proposalId, body?.force === true);
  }

  @Post('proposals/:proposalId/discard')
  discard(@Param('proposalId') proposalId: string): Promise<WorkflowChatProposal> {
    return this.proposals.discard(proposalId);
  }
}
