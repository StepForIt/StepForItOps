import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AssistantDraftRepairedEvent,
  GateVerdict,
  N8nWorkflow,
  EVENTS,
  AiAgentParams,
  AiMessage,
  AiPort,
  AiThinkingStep,
  AiToolTrace,
  AssistantProposalTarget,
  MAX_REPAIR_ROUNDS,
  WorkflowEditOperation,
  parseAssistantTurn,
  repairRequest,
} from '@nwm/core';
import { ProposalPartInput, ProposalService } from './proposal.service';
import { EventBusService } from '../../infra/events/event-bus.service';

/** Ce que la porte reproche, en texte pour le modèle et en findings pour l'apprentissage. */
interface Complaint {
  text: string;
  findings: AssistantDraftRepairedEvent['findings'];
}

/**
 * Les opérations, bornées avant de partir dans un événement. Un brouillon peut
 * peser des dizaines de ko (le `schema` d'un resourceMapper), et ce qu'on veut en
 * apprendre tient dans ses premières lignes.
 */
function truncate(json: string): string {
  return json.length <= 4000 ? json : `${json.slice(0, 4000)}…`;
}

/**
 * Ce qu'un refus apprend, résolu sur le candidat.
 *
 * Un finding porte un NOM de nœud, et c'est son TYPE qui rend une leçon
 * transposable : un nom ne vaut que dans son workflow, quand « ce type de nœud se
 * configure ainsi » vaut pour tout le parc. D'où le candidat — un nœud que la
 * proposition AJOUTE n'existe nulle part ailleurs où l'on pourrait le lire.
 */
function findingsToLearn(gate: GateVerdict, candidate: N8nWorkflow): AssistantDraftRepairedEvent['findings'] {
  const types = new Map((candidate.nodes ?? []).map((node) => [node.name, node.type]));
  return [...gate.refusals, ...gate.introduced.filter((finding) => finding.severity === 'error')].map(
    (finding) => ({
      code: finding.code,
      severity: finding.severity,
      nodeName: finding.nodeName ?? undefined,
      nodeType: finding.nodeName ? types.get(finding.nodeName) : undefined,
      message: finding.message,
    }),
  );
}

/** Une modification proposée par le modèle, avant qu'elle n'existe en base. */
export interface Draft {
  summary: string;
  operations: WorkflowEditOperation[];
  /**
   * Les sous-workflows visés, désignés par leur NOM — c'est ce que le modèle
   * écrit, et le nom doit rester tel quel jusqu'à la correction : lui renvoyer
   * un id plateforme dans une plainte ne l'aiderait pas à se relire.
   */
  targets: AssistantProposalTarget[];
}

/** Ce que le périmètre du tour répond quand on lui soumet les noms écrits par le modèle. */
export interface ResolvedTargets {
  parts: ProposalPartInput[];
  /**
   * Opérations rangées dans `targets` alors qu'elles visent le workflow de la
   * conversation. Recollées à la racine plutôt que refusées : le modèle nomme
   * volontiers le workflow ouvert comme les autres, et lui faire payer une passe
   * de correction pour un rangement n'apprend rien à personne.
   */
  rootOperations: WorkflowEditOperation[];
  /** Noms qui ne désignent aucun workflow du périmètre, ou un workflow non écrivable. */
  rejected: Array<{ workflow: string; reason: string }>;
}

export interface RepairResult {
  /**
   * Ce qu'on propose finalement. `null` quand le modèle a renoncé en cours de
   * correction : mieux vaut aucune proposition qu'un diff dont on sait qu'il ne
   * sera pas écrit.
   */
  draft: Draft | null;
  /** Ce qui s'est passé, à dire sous la réponse — une correction ne se cache pas. */
  outcome: 'clean' | 'repaired' | 'gave-up' | 'abandoned';
  /**
   * La réponse du DERNIER tour, quand une correction a eu lieu. La première
   * décrivait la modification refusée : la garder afficherait une explication qui
   * ne parle plus du diff qu'on propose — ou, quand le modèle a renoncé, tairait
   * ce qui lui manque, la seule chose utile du tour.
   */
  reply: string | null;
  /** Passes de correction consommées (0 = la première proposition passait). */
  attempts: number;
  trace: AiToolTrace[];
  thinking: AiThinkingStep[];
}

/**
 * Fait juger la proposition du modèle par la porte, dans le tour, et la lui
 * renvoie à corriger tant qu'elle ne passe pas.
 *
 * C'est le maillon qui manquait entre `check_workflow` et la revue du diff.
 * L'assistant dispose de l'outil, mais rien ne l'oblige à s'en servir, et ce
 * qu'il RECOPIE dans sa réponse finale n'est pas forcément ce qu'il a vérifié :
 * il sérialise ses opérations deux fois. Le refus se découvrait alors à l'écran,
 * sur un diff inapplicable — un tour perdu pour tout le monde, et une relance à
 * écrire à la main pour redire ce que la plateforme savait déjà.
 *
 * La boucle est bornée (`MAX_REPAIR_ROUNDS`) et chaque passe coûte un appel IA :
 * un refus qui persiste est rendu à l'humain, qui saura reformuler là où le
 * modèle tournerait en rond.
 */
@Injectable()
export class DraftRepairService {
  private readonly logger = new Logger(DraftRepairService.name);

  constructor(
    private readonly proposals: ProposalService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    private readonly bus: EventBusService,
  ) {}

  async repair(input: {
    workflowId: string;
    draft: Draft;
    /** Traduit les noms de workflows écrits par le modèle en cibles écrivables. */
    resolve: (targets: AssistantProposalTarget[]) => ResolvedTargets;
    /** L'appel du tour, à rejouer tel quel : mêmes outils, même contexte, même système. */
    call: Omit<AiAgentParams, 'messages'>;
    /** L'échange qui a produit ce brouillon, réponse brute du modèle comprise. */
    messages: AiMessage[];
    answer: string;
    /** Prévient l'écran qu'une passe de correction commence (l'attente double). */
    onRound?: (attempt: number) => void;
  }): Promise<RepairResult> {
    const trace: AiToolTrace[] = [];
    const thinking: AiThinkingStep[] = [];
    let draft = input.draft;
    let reply: string | null = null;
    // Le premier refus : c'est lui qui décrit la faute d'origine. Les suivants
    // parlent de ce que la correction a introduit, ce qui n'apprend rien sur la
    // façon dont le modèle écrit spontanément.
    let firstComplaint: Complaint | null = null;
    const refusedDraft = input.draft;
    let conversation: AiMessage[] = [...input.messages, { role: 'assistant', content: input.answer }];

    for (let attempt = 0; attempt <= MAX_REPAIR_ROUNDS; attempt += 1) {
      const complaint = await this.complaintFor(input.workflowId, draft, input.resolve);
      if (!complaint) {
        if (attempt > 0 && firstComplaint) {
          // Rouge puis vert, sans qu'aucun modèle n'ait jugé : la preuve la plus
          // nette dont on dispose que le brouillon d'origine était fautif.
          this.announceRepair(input.workflowId, firstComplaint, refusedDraft, draft);
        }
        return {
          draft,
          outcome: attempt === 0 ? 'clean' : 'repaired',
          attempts: attempt,
          reply,
          trace,
          thinking,
        };
      }
      firstComplaint ??= complaint;
      // Dernière passe consommée : on rend le brouillon tel quel plutôt que rien.
      // Le diff reste lisible, la revue dira ce qui bloque, et l'humain tranche.
      if (attempt === MAX_REPAIR_ROUNDS) {
        return { draft, outcome: 'gave-up', attempts: attempt, reply, trace, thinking };
      }

      input.onRound?.(attempt + 1);
      conversation = [...conversation, { role: 'user', content: complaint.text }];
      const result = await this.ai.chatWithTools({ ...input.call, messages: conversation });
      trace.push(...result.trace);
      thinking.push(...result.thinking);
      conversation = [...conversation, { role: 'assistant', content: result.text }];

      const turn = parseAssistantTurn(result.text);
      reply = turn.reply;
      if (!turn.proposal) {
        // Une enveloppe illisible n'est pas un renoncement : le modèle a bien
        // rédigé une correction, on ne sait pas la lire. On rend le brouillon
        // refusé plutôt que rien — la revue dira ce qui bloque.
        if (turn.malformed) {
          this.logger.warn(`Correction illisible (workflow ${input.workflowId})`);
          return { draft, outcome: 'gave-up', attempts: attempt + 1, reply, trace, thinking };
        }
        // Le modèle renonce, comme on le lui demande quand il ne sait pas
        // corriger. Insister produirait la même proposition refusée.
        this.logger.log(`Correction abandonnée par le modèle (workflow ${input.workflowId})`);
        return { draft: null, outcome: 'abandoned', attempts: attempt + 1, reply, trace, thinking };
      }
      draft = turn.proposal;
    }

    return { draft, outcome: 'gave-up', attempts: MAX_REPAIR_ROUNDS, reply, trace, thinking };
  }

  /**
   * Annonce au module d'apprentissage qu'un refus déterministe a été corrigé.
   *
   * Émis et non appelé : `assistant-learning` est un module métier désactivable,
   * qu'on n'importe pas. Rien n'est attendu en retour — la distillation coûte un
   * appel IA et n'a aucune raison de retarder la réponse à l'humain.
   */
  private announceRepair(workflowId: string, complaint: Complaint, refused: Draft, accepted: Draft): void {
    if (complaint.findings.length === 0) return;
    const event: AssistantDraftRepairedEvent = {
      workflowId,
      findings: complaint.findings,
      refused: truncate(JSON.stringify(refused.operations)),
      accepted: truncate(JSON.stringify(accepted.operations)),
    };
    this.bus.emit(EVENTS.assistantDraftRepaired, event);
  }

  /**
   * Ce qu'il y a à corriger dans ce brouillon, ou `null` s'il passe.
   *
   * Des opérations qu'on ne sait même pas appliquer sont un refus comme un
   * autre : le message d'erreur repart au modèle, qui l'a écrit lui-même.
   */
  private async complaintFor(
    workflowId: string,
    draft: Draft,
    resolve: (targets: AssistantProposalTarget[]) => ResolvedTargets,
  ): Promise<Complaint | null> {
    // Un nom de workflow hors périmètre est un refus AVANT tout contrôle : rien
    // ne sera écrit là où le modèle croit écrire, et le laisser passer donnerait
    // une proposition amputée de sa moitié sans que rien ne le dise.
    const { parts, rootOperations, rejected } = resolve(draft.targets);
    if (rejected.length > 0) {
      return {
        text:
          `STOP — ta proposition vise des workflows auxquels elle ne peut pas s'appliquer :\n` +
          rejected.map((entry) => `- « ${entry.workflow} » : ${entry.reason}`).join('\n') +
          `\n\nCorrige \`proposal.targets\` (le nom doit être EXACTEMENT celui du périmètre), ou ` +
          `retire ces cibles et dis en une ligne ce qui n'a pas pu être fait.`,
        // Un nom de cible erroné ne dit rien de la façon d'écrire un nœud : il n'y
        // a pas de règle à en tirer, seulement un périmètre à relire.
        findings: [],
      };
    }
    try {
      const verdicts = await this.proposals.evaluateAll(
        { workflowId, operations: [...draft.operations, ...rootOperations] },
        parts,
      );
      for (const verdict of verdicts) {
        const request = repairRequest(verdict.gate);
        if (!request) continue;
        // Le nom du workflow en tête : à plusieurs cibles, une plainte anonyme
        // envoie le modèle corriger celle qu'il a sous les yeux.
        return {
          text: `Workflow concerné : « ${verdict.workflowName} ».\n\n${request}`,
          findings: findingsToLearn(verdict.gate, verdict.candidate),
        };
      }
      return null;
    } catch (error) {
      const detail = (error as Error).message ?? 'erreur inconnue';
      this.logger.warn(`Brouillon non applicable (workflow ${workflowId}) : ${detail}`);
      return {
        text:
          `STOP — tes opérations ne sont même pas applicables au workflow : ${detail}\n\n` +
          `Relis les nœuds concernés (\`read_node\`), corrige, et renvoie les opérations COMPLÈTES ` +
          `dans \`proposal\`. Si tu ne sais pas corriger, renvoie \`proposal: null\` et dis ce qui manque.`,
        // Une opération inapplicable n'a pas de finding : la porte n'a pas eu lieu.
        // Rien à apprendre ici, l'erreur est dans la forme des opérations elles-mêmes.
        findings: [],
      };
    }
  }
}
