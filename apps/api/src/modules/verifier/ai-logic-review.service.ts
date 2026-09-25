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
          "Tu es un expert n8n. On te donne le JSON d'un workflow. " +
          'Analyse sa logique : incohérences, branches mortes, conditions toujours vraies/fausses, ' +
          "données attendues absentes, gestion d'erreur manquante. " +
          "Ne signale jamais comme « codée en dur » une valeur d'aspect gabarit ([productId], {{ x }}, <id>, TODO) : " +
          "c'est un trou à remplir, pas un oubli. Ces valeurs d'exemple restées en place " +
          '(YOUR_API_KEY, <domaine>, example.com) sont déjà relevées par une règle déterministe : ' +
          'ne les redis pas. ' +
          'Chaque remarque doit être actionnable : recopie dans "evidence" la valeur ou l\'expression visée, ' +
          'et donne dans "suggestion" le correctif concret. ' +
          'Le champ "alreadyDeclaredNormal" liste des remarques que l\'utilisateur a déjà déclarées ' +
          'normales et voulues sur ce workflow : ne les resignale pas, ni sous une autre formulation. ' +
          'Un nœud marqué "manualDebugBranch" n\'est atteignable que par le bouton ' +
          "« Execute workflow » : c'est de l'outillage de mise au point, jamais du chemin de " +
          "production. Ne juge pas ces nœuds comme s'ils tournaient en production (écrasement " +
          "de données, absence de filtre, valeurs en dur : c'est le but) ; ne les signale que " +
          'si la branche elle-même est cassée. ' +
          'Le champ "documentation" contient les annotations (sticky notes) laissées par l\'auteur, ' +
          "avec les nœuds couverts par chaque zone : sers-t'en comme contexte d'intention, " +
          'ne les signale jamais comme des problèmes. ' +
          'Réponds en JSON: {"understood": bool, "summary": "...", "issues": [{"nodeName": "...", "message": "...", ' +
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
          message: `L'IA n'a pas compris ce workflow : ${result.summary}`,
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
      this.logger.warn(`Revue IA KO : ${(error as Error).message}`);
      return [];
    }
  }
}
