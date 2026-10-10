import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Finding } from '@prisma/client';
import { detectWorkflowEnv, isMonitoredEnv, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { FindingAutoFixService } from './finding-autofix.service';
import { FindingFixService } from './finding-fix.service';
import { ProposalService } from './proposal.service';

export interface FindingFixAllResult {
  workflowId: string;
  /** Findings corrigés par la règle seule ET écrits dans n8n. */
  autoApplied: number;
  /** Findings confiés à l'IA, dont la proposition est écrite. */
  aiApplied: number;
  /** Une proposition attend une relecture humaine (prod, porte, conflit) : son id. */
  reviewProposalId: string | null;
  /** Pourquoi elle n'a pas été écrite d'office. */
  reviewReason: string | null;
  /** Findings que ni la règle ni l'IA n'ont pu traiter. */
  remaining: number;
  /** Conversation ouverte pour la part IA, pour relire ce qu'elle en dit. */
  sessionId: string | null;
}

/**
 * « Tout corriger » : un seul geste pour un workflow, au lieu de corriger, revoir le
 * diff puis publier groupe par groupe. L'orchestration seule vit ici, les deux
 * rédacteurs (règle, IA) et l'écriture gardée restent ceux d'habitude.
 *
 * Ce qui s'écrit d'office : un env qui n'est PAS surveillé (dev, recette). Un env
 * surveillé — la prod, ou un env indéterminé, que `isMonitoredEnv` traite comme tel —
 * s'arrête à la proposition, relue en diff : écrire en masse sur ce que des clients
 * exécutent doit rester un geste vu. La porte, le verrou, la chaîne d'env et le point
 * de retour s'appliquent comme pour n'importe quelle écriture ; un refus ne fait pas
 * échouer le geste, il laisse la proposition à relire avec son motif.
 */
@Injectable()
export class FindingFixAllService {
  private readonly logger = new Logger(FindingFixAllService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly autoFix: FindingAutoFixService,
    private readonly aiFix: FindingFixService,
    private readonly proposals: ProposalService,
  ) {}

  async fixAll(findingIds: string[]): Promise<FindingFixAllResult> {
    if (findingIds.length === 0) throw new BadRequestException(msg('chat.findingFixNone'));
    const findings = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      include: { workflow: { select: { name: true, tags: true } } },
    });
    if (findings.length === 0) throw new NotFoundException(msg('chat.findingFixNotFound'));
    const workflowId = findings[0]!.workflowId;
    if (findings.some((finding) => finding.workflowId !== workflowId)) {
      throw new BadRequestException(msg('chat.findingFixSameWorkflow'));
    }

    const { name, tags } = findings[0]!.workflow;
    const envs = await this.settings.declaredEnvs();
    const env = detectWorkflowEnv(name, tags, await this.settings.declaredEnvIds());
    const writeNow = !isMonitoredEnv(env, envs);

    const result: FindingFixAllResult = {
      workflowId,
      autoApplied: 0,
      aiApplied: 0,
      reviewProposalId: null,
      reviewReason: null,
      remaining: 0,
      sessionId: null,
    };

    // 1. Ce que la règle sait écrire seule : déterministe, sans appel IA.
    const byRule = findings.filter(isAutoFixable);
    const byAi = findings.filter((finding) => !isAutoFixable(finding));
    let ruleFixed = 0;
    if (byRule.length > 0) {
      try {
        const proposed = await this.autoFix.propose(byRule.map((finding) => finding.id));
        ruleFixed = byRule.length - proposed.skipped;
        const refusal = await this.tryWrite(proposed.proposalId, writeNow);
        if (refusal === null) result.autoApplied = ruleFixed;
        else {
          result.reviewProposalId = proposed.proposalId;
          result.reviewReason = refusal;
        }
      } catch (error) {
        // Correctif devenu faux depuis l'analyse : rien à écrire, ces findings restent.
        this.logger.warn(`Autofix skipped for ${workflowId}: ${(error as Error).message}`);
      }
    }

    // 2. Le reste part à l'IA. Seulement si rien n'attend déjà une relecture : les deux
    // propositions partent du même état, écrire l'une périme l'autre.
    if (byAi.length > 0 && result.reviewProposalId === null) {
      try {
        const proposed = await this.aiFix.proposeFix(byAi.map((finding) => finding.id));
        result.sessionId = proposed.sessionId;
        if (proposed.proposalId) {
          const refusal = await this.tryWrite(proposed.proposalId, writeNow);
          if (refusal === null) result.aiApplied = byAi.length;
          else {
            result.reviewProposalId = proposed.proposalId;
            result.reviewReason = refusal;
          }
        }
      } catch (error) {
        // L'IA indisponible n'annule pas ce que la règle a déjà corrigé.
        this.logger.warn(`AI fix failed for ${workflowId}: ${(error as Error).message}`);
      }
    }

    result.remaining = findings.length - result.autoApplied - result.aiApplied;
    return result;
  }

  /** Écrit la proposition si l'env le permet. Rend `null` si écrite, sinon le motif. */
  private async tryWrite(proposalId: string, writeNow: boolean): Promise<string | null> {
    if (!writeNow) return msg('chat.fixAllNeedsReview');
    try {
      await this.proposals.apply(proposalId, false);
      return null;
    } catch (error) {
      if (error instanceof HttpException) return error.message;
      throw error;
    }
  }
}

function isAutoFixable(finding: Finding): boolean {
  return Boolean((finding.data as { autoFix?: boolean } | null)?.autoFix);
}
