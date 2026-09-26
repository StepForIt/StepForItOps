import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiAgentEvent,
  AiMessage,
  AiPort,
  AiThinkingStep,
  AiToolLoopError,
  AiToolTrace,
  BlueprintEditError,
  DOCS_PORT,
  DocsPort,
  MAX_REPAIR_ROUNDS,
  MakeEditOperation,
  blueprintDocContext,
  msg,
  parseAssistantTurn,
  repairNote,
  summarizeMakeOperations,
  toolProgressStep,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { MakeProposalService } from './make-proposal.service';
import { makeChatSystemPrompt, makeRepairRequest } from './make-chat-prompt';
import { CheckedMakeDraft, buildMakeChatTools } from './make-chat-tools';
import { ChatMemoryService } from './chat-memory.service';
import { ChatHistoryService } from './chat-history.service';
import { ChatProgressService } from './chat-progress.service';

/** Allers-retours d'outils par tour : relire deux ou trois modules, vérifier, corriger, revérifier. */
const MAX_TOOL_ROUNDS = 10;

/**
 * Au-delà, le contexte part sans la configuration des modules : un gros scénario
 * se payerait en entier à chaque tour, et `read_module` la sert à la demande.
 */
const CONTEXT_MAX_CHARS = 120_000;

export interface MakeTurnResult {
  reply: string;
  proposalId: string | null;
  trace: AiToolTrace[];
  thinking: AiThinkingStep[];
}

/**
 * Le tour de l'assistant sur un scénario Make.
 *
 * `ChatService` garde tout ce qui ne lit pas le contenu — session, historique,
 * pièces jointes, arrêt, enregistrement de la réponse — et confie ici ce qui le
 * lit : le contexte, les outils, la porte et la proposition. Deux tours dans un
 * même service se seraient mêlés au premier ajustement de l'un.
 */
@Injectable()
export class MakeChatTurnService {
  private readonly logger = new Logger(MakeChatTurnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly proposals: MakeProposalService,
    private readonly memory: ChatMemoryService,
    private readonly history: ChatHistoryService,
    private readonly progress: ChatProgressService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(DOCS_PORT) private readonly docs: DocsPort,
  ) {}

  async answer(input: {
    sessionId: string;
    workflowId: string;
    history: AiMessage[];
    signal?: AbortSignal;
  }): Promise<MakeTurnResult> {
    const { sessionId, workflowId } = input;
    this.progress.step(sessionId, { label: msg('chat.progressSyncScenario'), done: false });
    const { workflow, raw } = await this.freshScenario(workflowId);
    this.progress.step(sessionId, { label: msg('chat.progressContext'), done: false });

    const checked: CheckedMakeDraft[] = [];
    const tools = buildMakeChatTools({
      blueprint: raw,
      evaluate: async (operations) => {
        const { gate, warnings } = await this.proposals.evaluate(workflowId, operations);
        return { gate, warnings };
      },
      draftChecked: (draft) => checked.push(draft),
      remember: (fact) => this.memory.remember(workflowId, fact, sessionId),
      listConversations: () => this.history.list(workflowId, sessionId),
      readConversation: (target) => this.history.read(workflowId, target),
      searchDocs: (search) => this.docs.searchLibraries(search),
      readDocs: (search) => this.docs.readDocs(search),
    });
    const call = {
      system: makeChatSystemPrompt(),
      tools,
      maxRounds: MAX_TOOL_ROUNDS,
      maxTokens: 8192,
      effort: 'medium' as const,
      signal: input.signal,
      showThinking: true,
      onProgress: (event: AiAgentEvent) => {
        if (event.type === 'round') {
          this.progress.step(sessionId, {
            label: msg(event.round === 0 ? 'chat.progressAnalyseScenario' : 'chat.progressAnalyseMore'),
            done: false,
          });
        } else if (event.type === 'tool') {
          this.progress.step(sessionId, toolProgressStep(event.name, event.input));
        } else if (event.type === 'tool-result' && event.failed) {
          this.progress.fail(sessionId);
        }
      },
    };
    const messages: AiMessage[] = [
      await this.contextMessage(workflowId, workflow, raw),
      { role: 'assistant', content: 'Scenario context received.' },
      ...input.history,
    ];

    let answer = '';
    let trace: AiToolTrace[] = [];
    let thinking: AiThinkingStep[] = [];
    let failureNote: string | null = null;
    try {
      const result = await this.ai.chatWithTools({ ...call, messages });
      ({ text: answer, trace, thinking } = result);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      const detail = (error as Error).message ?? msg('chat.unknownError');
      if (error instanceof AiToolLoopError) ({ trace, thinking } = error);
      if (!lastClean(checked)) {
        return { reply: msg('chat.aiCallFailed', { detail }), proposalId: null, trace, thinking };
      }
      failureNote = msg('chat.aiCallFailedSalvaged', { detail });
    }

    this.progress.step(sessionId, { label: msg('chat.progressWriting'), done: false });
    const turn = parseAssistantTurn(answer);
    let reply = failureNote ?? turn.reply;
    if (turn.proposal && turn.proposal.targets.length > 0) {
      reply = `${reply}\n\n${msg('chat.makeOnlyOpenScenario')}`;
    }

    // Ce que la réponse porte, ou le dernier brouillon que la porte a laissé passer :
    // le modèle sérialise ses opérations deux fois, et perdre la seconde suffisait
    // à perdre la proposition entière.
    const fromReply = turn.proposal?.operations.length
      ? {
          summary: turn.proposal.summary,
          operations: turn.proposal.operations as unknown as MakeEditOperation[],
          salvaged: false,
        }
      : null;
    const salvaged = lastClean(checked);
    let draft =
      fromReply ??
      (salvaged
        ? {
            summary: summarizeMakeOperations(salvaged.operations),
            operations: salvaged.operations,
            salvaged: true,
          }
        : null);

    if (!draft) {
      if (turn.malformed) {
        reply = `${reply}\n\n${msg('chat.makeProposalUnreadable')}`;
      }
      return { reply, proposalId: null, trace, thinking };
    }

    // La proposition ne va pas à l'écran sans avoir passé la porte : refusée, elle
    // repart au modèle dans le même tour, deux passes au plus.
    let attempts = 0;
    let conversation = messages;
    let lastAnswer = answer;
    for (;;) {
      const verdict = await this.judge(workflowId, draft.operations);
      if (verdict.ok || attempts >= MAX_REPAIR_ROUNDS) break;
      attempts += 1;
      this.progress.step(sessionId, {
        label: msg('chat.progressRepair', { attempt: attempts }),
        done: false,
      });
      conversation = [
        ...conversation,
        { role: 'assistant', content: lastAnswer || JSON.stringify({ reply, proposal: draft }) },
        { role: 'user', content: makeRepairRequest(verdict.reason, verdict.errors) },
      ];
      try {
        const repaired = await this.ai.chatWithTools({ ...call, messages: conversation });
        trace = [...trace, ...repaired.trace];
        thinking = [...thinking, ...repaired.thinking];
        lastAnswer = repaired.text;
        const next = parseAssistantTurn(repaired.text);
        if (next.reply) reply = next.reply;
        if (!next.proposal?.operations.length) {
          return {
            reply: `${reply}\n\n${repairNote('abandoned', attempts)}`,
            proposalId: null,
            trace,
            thinking,
          };
        }
        draft = {
          summary: next.proposal.summary,
          operations: next.proposal.operations as unknown as MakeEditOperation[],
          salvaged: false,
        };
      } catch (error) {
        if (input.signal?.aborted) throw error;
        this.logger.warn(`Repair pass failed (session ${sessionId}): ${(error as Error).message}`);
        break;
      }
    }

    try {
      const { proposal, gate } = await this.proposals.create(
        workflowId,
        sessionId,
        draft.summary,
        draft.operations,
      );
      if (draft.salvaged && !failureNote) {
        reply = `${reply}\n\n${msg('chat.replySalvagedDraft')}`;
      }
      if (attempts > 0) reply = `${reply}\n\n${repairNote(gate.blocked ? 'gave-up' : 'repaired', attempts)}`;
      if (gate.reason) reply = `${reply}\n\n> ${gate.blocked ? '⛔' : '⚠️'} ${gate.reason}`;
      return { reply, proposalId: proposal.id, trace, thinking };
    } catch (error) {
      const detail = (error as Error).message ?? msg('chat.unknownError');
      this.logger.warn(`Make proposal rejected (${workflowId}): ${detail}`);
      return {
        reply: `${reply}\n\n${msg('chat.replyProposalNotKept', { detail })}`,
        proposalId: null,
        trace,
        thinking,
      };
    }
  }

  /** Le verdict d'un brouillon : applicable, ou ce qu'il faut dire au modèle pour qu'il corrige. */
  private async judge(
    workflowId: string,
    operations: MakeEditOperation[],
  ): Promise<{ ok: true } | { ok: false; reason: string; errors: string[] }> {
    try {
      const { gate } = await this.proposals.evaluate(workflowId, operations);
      if (!gate.blocked) return { ok: true };
      return {
        ok: false,
        reason: gate.reason ?? 'The gate refuses this draft.',
        errors: gate.introduced
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.nodeName ? `"${finding.nodeName}": ` : ''}${finding.message}`),
      };
    } catch (error) {
      if (error instanceof BlueprintEditError) return { ok: false, reason: error.message, errors: [] };
      throw error;
    }
  }

  /** Relu depuis Make ; Make injoignable ne coupe pas la conversation, c'est l'application qui refusera. */
  private async freshScenario(workflowId: string) {
    try {
      return await this.workflows.getFreshRawAny(workflowId);
    } catch (error) {
      this.logger.warn(`Cannot reload from Make (${workflowId}): ${(error as Error).message}`);
      return this.workflows.getRawAny(workflowId);
    }
  }

  private async contextMessage(
    workflowId: string,
    workflow: { name: string; active: boolean; tags: string[] },
    raw: unknown,
  ): Promise<AiMessage> {
    const findings = await this.prisma.finding.findMany({
      where: { workflowId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { severity: true, code: true, nodeName: true, message: true },
    });
    const scenario = blueprintDocContext(raw, workflow.name);
    let context: unknown = { ...scenario, active: workflow.active, tags: workflow.tags, findings };
    if (JSON.stringify(context).length > CONTEXT_MAX_CHARS) {
      context = {
        ...(context as object),
        modules: scenario.modules.map(({ id, name, module }) => ({ id, name, module })),
        note: 'Large scenario: the module configuration is pruned — read it with read_module.',
      };
    }
    const brief = await this.memory.brief(workflowId);
    const preamble = brief
      ? `What you have already been told about this scenario, and which still holds:\n${brief}\n\n`
      : '';
    return { role: 'user', content: `${preamble}Make scenario under analysis:\n${JSON.stringify(context)}` };
  }
}

function lastClean(drafts: CheckedMakeDraft[]): CheckedMakeDraft | null {
  return [...drafts].reverse().find((draft) => draft.clean && draft.operations.length > 0) ?? null;
}
