import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  CheckFinding,
  EVENTS,
  isGroupFullyDisabled,
  isNoisyAiFinding,
  locateQuote,
  writeInLanguage,
} from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { FindingIgnoreService, IgnoredRuleHint } from '../workflows/finding-ignore.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';
import { extractCodeNodes } from './code-node-extractor';
import { analyzeCodeNode } from './js-static-analysis';

interface AiJsIssue {
  message: string;
  severity?: 'info' | 'warning' | 'error';
  /** Fragment du code visé, recopié tel quel : sert à situer le finding ET à le vérifier. */
  quote?: string;
  /** Correctif proposé, affiché sous le message. */
  suggestion?: string;
}

/**
 * Remarques retenues par nœud. Au-delà, la revue liste des variantes du même
 * doute : c'est ce volume qui fait qu'on ne lit plus la page.
 */
const MAX_AI_ISSUES_PER_NODE = 3;

@Injectable()
export class JsCheckerService {
  private readonly logger = new Logger(JsCheckerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly ignores: FindingIgnoreService,
    private readonly profiles: CheckProfilesService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    private readonly platformLocale: PlatformLocale,
  ) {}

  /** `disabledChecks` : sélection de l'écran de lancement, prioritaire sur le profil enregistré. */
  check(workflowId: string, withAi: boolean, disabledChecks?: string[]): Promise<Finding[]> {
    // Les findings sont stockés pour tous : dans la langue de la plateforme, pas celle du lanceur.
    return this.platformLocale.run(() => this.runChecks(workflowId, withAi, disabledChecks));
  }

  private async runChecks(
    workflowId: string,
    withAi: boolean,
    disabledChecks?: string[],
  ): Promise<Finding[]> {
    const { raw } = await this.workflows.getRaw(workflowId);
    const codeNodes = extractCodeNodes(raw);
    const disabled = await this.profiles.effective(workflowId, disabledChecks);
    const off = new Set(disabled);
    const found: CheckFinding[] = [];

    for (const node of codeNodes) {
      found.push(...analyzeCodeNode(node).filter((finding) => !off.has(finding.code)));
    }
    if (
      withAi &&
      codeNodes.length > 0 &&
      !isGroupFullyDisabled(disabled, 'js-ai') &&
      (await this.ai.isConfigured())
    ) {
      // Ce qui a déjà été déclaré normal est rappelé à la revue : sans ça elle le
      // retrouve à chaque passe, et le post-filtre le jette une fois rédigé.
      const ignored = await this.ignores.hintsFor(workflowId, 'js-checker');
      // Les nœuds sont indépendants : les revoir en série multipliait la durée
      // de l'analyse par leur nombre.
      const reviews = await Promise.all(
        codeNodes.map((node) =>
          this.aiReviewNode(
            node.nodeName,
            node.mode,
            node.code,
            ignored.filter((rule) => rule.nodeName === null || rule.nodeName === node.nodeName),
          ),
        ),
      );
      found.push(...reviews.flat());
    }
    // Les findings déclarés « normaux » ne sont jamais persistés
    const { kept: findings } = await this.ignores.filterIgnored(workflowId, 'js-checker', found);
    await this.prisma.finding.deleteMany({ where: { workflowId, module: 'js-checker' } });
    await this.prisma.finding.createMany({
      data: findings.map((f) => ({
        workflowId,
        module: 'js-checker',
        severity: f.severity,
        code: f.code,
        message: f.message,
        nodeName: f.nodeName,
        data: f.data as object | undefined,
      })),
    });
    const stored = await this.prisma.finding.findMany({ where: { workflowId, module: 'js-checker' } });
    await this.prisma.analysisRun.create({
      data: { workflowId, module: 'js-checker', findingsCount: stored.length },
    });
    this.eventBus.emit(EVENTS.jsCheckCompleted, { workflowId, findingsCount: stored.length });
    return stored;
  }

  private async aiReviewNode(
    nodeName: string,
    mode: string,
    code: string,
    ignored: IgnoredRuleHint[] = [],
  ): Promise<CheckFinding[]> {
    const alreadyNormal =
      ignored.length > 0
        ? `\n\nRemarks ALREADY declared normal on this node — do not report them again, not even reworded:\n${ignored
            .map((rule) => `- ${rule.message}${rule.reason ? ` (reason: ${rule.reason})` : ''}`)
            .join('\n')}`
        : '';
    try {
      const issues = await this.ai.generateJson<AiJsIssue[]>({
        system:
          "You are an expert in the n8n Code node. You are given a node's JS and its execution mode. " +
          'Detect the cases where this code can BREAK at runtime (missing data, unguarded indexed access, ' +
          'badly handled async, mutation of items). ' +
          'NEVER report: the shape of the return value (n8n itself wraps an object or an array of objects), ' +
          'a console.log, or a template-looking value ([productId], {{ x }}, <id>, TODO) presented as "hardcoded". ' +
          'Every remark must be actionable: copy into "quote" the targeted line of code, verbatim, ' +
          'and give in "suggestion" the concrete fix. If you have nothing solid, answer []. ' +
          `${writeInLanguage()} ` +
          `Answer in JSON: [{"message": "...", "severity": "info"|"warning"|"error", "quote": "...", "suggestion": "..."}] (max ${MAX_AI_ISSUES_PER_NODE} items).`,
        prompt: `mode: ${mode}\n\n${code}${alreadyNormal}`,
        // Le budget couvre aussi le raisonnement du modèle (cf. ai-logic-review).
        maxTokens: 4096,
        effort: 'low',
      });
      return issues
        .filter((issue) => !isNoisyAiFinding(issue.message, issue.quote))
        .slice(0, MAX_AI_ISSUES_PER_NODE)
        .map((issue) => ({
          severity: issue.severity ?? 'info',
          code: 'js-ai',
          message: issue.message,
          nodeName,
          data: {
            // Citation introuvable ⇒ pas de ligne : mieux vaut aucun repère qu'un faux.
            ...(issue.quote ? (locateQuote(code, issue.quote) ?? {}) : {}),
            ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
          },
        }));
    } catch (error) {
      this.logger.warn(`AI review of node "${nodeName}" failed: ${(error as Error).message}`);
      return [];
    }
  }
}
