import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  CheckFinding,
  N8nWorkflow,
  buildStickyZones,
  isDefaultStickyContent,
  isNoisyAiFinding,
  isStickyNote,
  manualOnlyNodes,
  msg,
  writeInLanguage,
} from '@nwm/core';
import { IgnoredRuleHint } from '../workflows/finding-ignore.service';

interface AiReviewResult {
  understood: boolean;
  summary: string;
  issues: Array<{
    nodeName?: string;
    message: string;
    severity?: 'info' | 'warning';
    /** Valeur ou expression visée, recopiée telle quelle : sert à vérifier la remarque. */
    evidence?: string;
    /** Correctif proposé, affiché sous le message. */
    suggestion?: string;
  }>;
}

/** Revue logique d'un workflow par l'IA (optionnelle : dépend de la clé API). */
@Injectable()
export class AiLogicReviewService {
  private readonly logger = new Logger(AiLogicReviewService.name);

  constructor(@Inject(AI_PORT) private readonly ai: AiPort) {}

  isAvailable(): Promise<boolean> {
    return this.ai.isConfigured();
  }

  async review(workflow: N8nWorkflow, ignored: IgnoredRuleHint[] = []): Promise<CheckFinding[]> {
    if (!(await this.ai.isConfigured())) return [];
    try {
      const zones = buildStickyZones(workflow);
      const documentation = zones.stickies
        .filter((s) => !isDefaultStickyContent(s.content))
        .map((s) => ({ note: s.content, coversNodes: zones.nodesByZone.get(s.name) ?? [] }));
      // Branche qu'on ne lance qu'au bouton : c'est de l'outillage, pas le chemin
      // de production. Sans ce drapeau, la revue lit un « écrase tous les statuts »
      // comme un risque en prod, alors qu'il est là pour remettre un jeu d'essai à zéro.
      const manualOnly = manualOnlyNodes(workflow);
      const compact = {
        name: workflow.name,
        nodes: workflow.nodes
          .filter((n) => !isStickyNote(n))
          .map((n) => ({
            name: n.name,
            type: n.type,
            disabled: n.disabled ?? false,
            ...(manualOnly.has(n.name) ? { manualDebugBranch: true } : {}),
            parameters: n.parameters,
          })),
        connections: workflow.connections,
        documentation,
        // Remarques déjà déclarées normales par l'utilisateur. Sans elles, la revue
        // les retrouve à chaque passe : le post-filtre les jette, mais après les
        // avoir fait chercher et rédiger.
        alreadyDeclaredNormal: ignored.map((rule) => ({
          nodeName: rule.nodeName ?? undefined,
          message: rule.message,
          ...(rule.reason ? { reason: rule.reason } : {}),
        })),
      };
      const result = await this.ai.generateJson<AiReviewResult>({
        system:
          "You are an n8n expert. You are given a workflow's JSON. " +
          'Analyse its logic: inconsistencies, dead branches, always-true/false conditions, ' +
          'expected data that is missing, missing error handling. ' +
          'Never report as "hardcoded" a template-looking value ([productId], {{ x }}, <id>, TODO): ' +
          'it is a gap to fill, not an oversight. Example values left in place ' +
          '(YOUR_API_KEY, <domain>, example.com) are already caught by a deterministic rule: ' +
          'do not repeat them. ' +
          'Every remark must be actionable: copy into "evidence" the targeted value or expression, ' +
          'and give in "suggestion" the concrete fix. ' +
          'The "alreadyDeclaredNormal" field lists remarks the user has already declared ' +
          'normal and intended on this workflow: do not report them again, not even reworded. ' +
          'A node flagged "manualDebugBranch" is only reachable through the ' +
          '"Execute workflow" button: it is debugging tooling, never a production ' +
          'path. Do not judge these nodes as if they ran in production (data being ' +
          'overwritten, no filter, hardcoded values: that is the point); only report them ' +
          'if the branch itself is broken. ' +
          'The "documentation" field holds the annotations (sticky notes) left by the author, ' +
          'with the nodes covered by each zone: use them as context about intent, ' +
          'never report them as problems. ' +
          `${writeInLanguage()} ` +
          'Answer in JSON: {"understood": bool, "summary": "...", "issues": [{"nodeName": "...", "message": "...", ' +
          '"severity": "info"|"warning", "evidence": "...", "suggestion": "..."}]}',
        prompt: JSON.stringify(compact),
        // Le budget couvre aussi le raisonnement du modèle : trop juste, la
        // revue revenait tronquée (JSON invalide) après ~35 s de calcul perdu.
        maxTokens: 8192,
        effort: 'low',
      });

      const findings: CheckFinding[] = result.issues
        .filter((issue) => !isNoisyAiFinding(issue.message, issue.evidence))
        .map((issue) => ({
          // Filet déterministe derrière la consigne : une remarque visant un nœud
          // de branche manuelle ne passe jamais en warning — un prompt seul ne s'y
          // tient pas, et un outil de debug n'est pas un risque de production.
          severity: issue.nodeName && manualOnly.has(issue.nodeName) ? 'info' : (issue.severity ?? 'info'),
          code: 'ai-logic',
          message: issue.message,
          nodeName: issue.nodeName,
          ...(issue.suggestion ? { data: { suggestion: issue.suggestion } } : {}),
        }));
      if (!result.understood) {
        findings.unshift({
          severity: 'warning',
          code: 'ai-not-understood',
          message: msg('analysis.aiNotUnderstood', { summary: result.summary }),
        });
      } else {
        findings.unshift({
          severity: 'info',
          code: 'ai-summary',
          message: result.summary,
        });
      }
      return findings;
    } catch (error) {
      this.logger.warn(`AI review failed: ${(error as Error).message}`);
      return [];
    }
  }
}
