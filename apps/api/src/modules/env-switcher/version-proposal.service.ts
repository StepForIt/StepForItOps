import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  BumpLevel,
  BumpProposal,
  WorkflowDiff,
  aiBumpCeiling,
  capAiBump,
  msg,
  suggestBumpLevel,
  writeInLanguage,
} from '@nwm/core';

/** Ce que l'IA a le droit de répondre : rien d'autre ne sera lu. */
const LEVELS: BumpLevel[] = ['major', 'minor', 'patch'];

/** Assez pour le raisonnement ET la réponse : un budget trop juste renvoie du tronqué. */
const MAX_TOKENS = 1024;

/** Au-delà, on n'envoie plus le détail nœud par nœud : les compteurs suffisent. */
const MAX_NODE_LINES = 40;

export interface VersionProposal extends BumpProposal {
  /** `ai` quand le modèle a tranché, `rules` quand c'est le calcul déterministe. */
  source: 'ai' | 'rules';
}

/**
 * Quel digit incrémenter, proposé au moment de la promotion à partir de CE qui
 * change — pas d'une convention posée une fois pour toutes.
 *
 * Le calcul déterministe (`suggestBumpLevel`) tranche toujours en premier : il
 * est la proposition par défaut ET le repli. L'IA ne fait que l'affiner, avec le
 * détail que le diff porte et que la règle ne sait pas lire (« ce paramètre-là
 * change le destinataire des factures »), d'un cran au plus au-dessus d'elle
 * (`capAiBump`). Sans clé, sans réseau ou sur une
 * réponse hors des trois niveaux, on garde la règle : le numéro de version ne
 * doit pas dépendre de la disponibilité d'une API.
 *
 * Dans tous les cas c'est une PROPOSITION — la modale de promotion la montre,
 * avec sa raison, et l'humain peut en choisir une autre.
 */
@Injectable()
export class VersionProposalService {
  private readonly logger = new Logger(VersionProposalService.name);

  constructor(@Inject(AI_PORT) private readonly ai: AiPort) {}

  async propose(
    diff: WorkflowDiff | undefined,
    context: { name: string; targetEnv?: string },
    /** Faux pour les préparations internes (chaque étape d'une cascade) : seule
     * la modale a besoin d'une proposition, la payer dix fois n'apporte rien. */
    useAi = true,
  ): Promise<VersionProposal> {
    // Création sur la cible : il n'y a rien à comparer, et rien à incrémenter non
    // plus — le workflow arrive, il prend sa première version.
    if (!diff) {
      return {
        level: 'minor',
        reason: msg('env.versionNewOnTarget', { name: context.name }),
        source: 'rules',
      };
    }
    const rules = suggestBumpLevel(diff);
    if (!diff.hasChanges) return { ...rules, source: 'rules' };
    if (!useAi || !(await this.ai.isConfigured())) return { ...rules, source: 'rules' };

    try {
      const answer = await this.ai.generateJson<{ level?: string; reason?: string }>({
        system:
          'You classify a change to an n8n workflow in semantic versioning, from the point of view of ' +
          'THOSE WHO CALL IT and of what the workflow does in production.\n' +
          '- major: the contract changes or something disappears (trigger, webhook URL, ' +
          'schedule, removed step, output that changes shape).\n' +
          '- minor: the workflow does something MORE, without removing anything.\n' +
          '- patch: setting, fix, adjusted value — nothing new, nothing lost.\n' +
          `A deterministic rule suggests "${rules.level}" (${rules.reason}): only contradict it if the ` +
          `detail of the change truly justifies it, and do not go beyond "${aiBumpCeiling(rules.level)}". ` +
          'A displayed name or url (cachedResultName, cachedResultUrl) changes nothing in what the workflow does.\n' +
          'Answer in JSON: {"level":"major|minor|patch","reason":"one sentence, what it concretely changes"}\n' +
          writeInLanguage(),
        prompt: JSON.stringify({ workflow: context.name, targetEnv: context.targetEnv, ...summarize(diff) }),
        maxTokens: MAX_TOKENS,
        effort: 'low',
      });
      const level = LEVELS.find((candidate) => candidate === answer?.level);
      if (!level) return { ...rules, source: 'rules' };
      const capped = capAiBump(rules.level, level);
      const reason = answer.reason?.trim() || rules.reason;
      return {
        level: capped.level,
        reason: capped.capped
          ? msg('env.versionAiCapped', { reason, proposed: level, capped: capped.level, rule: rules.level })
          : reason,
        source: 'ai',
      };
    } catch (error) {
      this.logger.warn(`Version level left to the rule: ${(error as Error).message}`);
      return { ...rules, source: 'rules' };
    }
  }
}

/**
 * Le diff réduit à ce qui décide du niveau. Envoyer le diff entier ferait payer
 * les milliers de lignes JSON d'un gros workflow pour un mot de réponse.
 */
function summarize(diff: WorkflowDiff) {
  return {
    renamed: diff.nameChange,
    counts: diff.counts,
    connectionsChanged: diff.connections.changed,
    settingsChanged: diff.settings.changed,
    nodes: diff.nodes.slice(0, MAX_NODE_LINES).map((node) => ({
      name: node.name,
      type: node.nodeType,
      change: node.change,
      fields: node.fields,
      // Les explications en clair (« retire le samedi du planning ») disent
      // l'ampleur là où le nom du champ ne dit que l'endroit.
      effects: node.explanations.map((explanation) => explanation.text),
    })),
    connectionEffects: diff.connections.explanations.map((explanation) => explanation.text),
  };
}
