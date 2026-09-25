import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  CheckFinding,
  EVENTS,
  isGroupFullyDisabled,
  isNoisyAiFinding,
  locateQuote,
} from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { FindingIgnoreService, IgnoredRuleHint } from '../workflows/finding-ignore.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
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
  ) {}

  /** `disabledChecks` : sélection de l'écran de lancement, prioritaire sur le profil enregistré. */
  async check(workflowId: string, withAi: boolean, disabledChecks?: string[]): Promise<Finding[]> {
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
        ? `\n\nRemarques DÉJÀ déclarées normales sur ce nœud — ne les resignale pas, ni sous une autre formulation :\n${ignored
            .map((rule) => `- ${rule.message}${rule.reason ? ` (raison : ${rule.reason})` : ''}`)
            .join('\n')}`
        : '';
    try {
      const issues = await this.ai.generateJson<AiJsIssue[]>({
        system:
          "Tu es un expert du nœud Code n8n. On te donne le JS d'un nœud et son mode d'exécution. " +
          "Détecte les cas où ce code peut CASSER à l'exécution (données absentes, accès indexé sans garde, " +
          "async mal géré, mutation d'items). " +
          "Ne signale JAMAIS : la forme du retour (n8n enveloppe lui-même un objet ou un tableau d'objets), " +
          "un console.log, ni une valeur d'aspect gabarit ([productId], {{ x }}, <id>, TODO) présentée comme « codée en dur ». " +
          'Chaque remarque doit être actionnable : recopie dans "quote" la ligne de code visée, telle quelle, ' +
          'et donne dans "suggestion" le correctif concret. Si tu n\'as rien de solide, réponds []. ' +
          `Réponds en JSON: [{"message": "...", "severity": "info"|"warning"|"error", "quote": "...", "suggestion": "..."}] (max ${MAX_AI_ISSUES_PER_NODE} items).`,
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
      this.logger.warn(`Revue IA du nœud "${nodeName}" KO : ${(error as Error).message}`);
      return [];
    }
  }
}
