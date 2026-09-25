import { CheckFinding } from './check-finding';
import { LlmTask } from './llm-task';
import {
  ModelCatalogEntry,
  ModelNeeds,
  ModelTier,
  ModelUsageMix,
  bestCandidate,
  isFloatingAlias,
  matchModelCatalog,
  tierRank,
} from './model-catalog';

/**
 * Les règles de l'audit des modèles, PURES : elles reçoivent le catalogue et
 * les mesures, comme `node-schema.ts` reçoit ses schémas. C'est ce qui les rend
 * jouables aussi bien par le cron du module que par la porte de l'assistant.
 *
 * Trois axes : les APTITUDES (le modèle sait-il faire ce qu'on lui demande),
 * le CYCLE DE VIE (est-il encore là, et pas payé trop cher à tier conservé), et
 * la TÂCHE (le seul axe qui autorise une descente de tier).
 */

/** Ce qu'un nœud modèle demande, lu du contenu du workflow. Neutre : Make pourra l'alimenter. */
export interface LlmNodeRequirement {
  nodeName: string;
  /** Le modèle tel qu'il est ÉCRIT dans le nœud ; null = porté par une expression. */
  model: string | null;
  needsVision: boolean;
  needsTools: boolean;
  needsStructuredOutput: boolean;
  /** Le nœud servi (Agent, chaîne) : c'est lui que l'humain reconnaît. */
  servesNode: string | null;
  /** Gabarit de prompt, pour l'empreinte de classification. */
  promptTemplate?: string | null;
}

/** Ce que les exécutions ont MESURÉ pour ce nœud. Absent = les règles mesurées se taisent. */
export interface LlmNodeUsage {
  promptTokensP95: number;
  promptTokens: number;
  completionTokens: number;
  days: number;
  calls: number;
}

export interface LlmNodeTaskVerdict {
  task: LlmTask;
  confidence: number;
  /** La phrase du prompt qui a produit l'étiquette : sans elle, rien à contredire. */
  evidence?: string | null;
  /** `ai` ou `manual` — une correction humaine ne se discute pas. */
  source: 'ai' | 'manual';
}

export interface ModelAuditThresholds {
  savingsThresholdPct: number;
  minAnnualSavingsUsd: number;
  /** Part de la fenêtre au-delà de laquelle on alerte (0.8 = 80 %). */
  contextHeadroom: number;
  /** Confiance minimale d'une classification IA pour être exploitée. */
  minTaskConfidence: number;
}

export const DEFAULT_MODEL_AUDIT_THRESHOLDS: ModelAuditThresholds = {
  savingsThresholdPct: 30,
  minAnnualSavingsUsd: 5,
  contextHeadroom: 0.8,
  minTaskConfidence: 0.7,
};

export interface ModelAuditInput {
  requirements: LlmNodeRequirement[];
  catalog: ModelCatalogEntry[];
  usageByNode?: Record<string, LlmNodeUsage>;
  taskByNode?: Record<string, LlmNodeTaskVerdict>;
  /** Plancher de tier par tâche (`ModelTaskProfile`). */
  taskProfiles?: Record<string, ModelTier>;
  thresholds?: Partial<ModelAuditThresholds>;
  /**
   * Le catalogue a-t-il été confronté à une source trop vieille ? Alors tout ce
   * qui dépend de la fraîcheur SE TAIT — un catalogue périmé qui se tait vaut
   * mieux qu'un catalogue périmé qui affirme.
   */
  catalogStale?: boolean;
  now?: Date;
}

export function runModelAudit(input: ModelAuditInput): CheckFinding[] {
  const thresholds = { ...DEFAULT_MODEL_AUDIT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const stale = input.catalogStale === true;
  const now = input.now ?? new Date();
  const findings: CheckFinding[] = [];

  for (const requirement of input.requirements) {
    const model = requirement.model?.trim();
    if (!model) continue; // modèle porté par une expression : rien à juger.

    const entry = matchModelCatalog(model, input.catalog);
    const usage = input.usageByNode?.[requirement.nodeName];
    const base = { model, nodeName: requirement.nodeName, servesNode: requirement.servesNode ?? undefined };

    if (isFloatingAlias(model)) {
      findings.push({
        severity: 'warning',
        code: 'model-floating-alias',
        nodeName: requirement.nodeName,
        message: `Le modèle « ${model} » est un alias flottant : il change sans que le workflow bouge.`,
        data: {
          ...base,
          suggestion: 'Épingler une version datée, pour que le comportement du workflow soit décidé ici.',
        },
      });
    }

    if (!entry) {
      findings.push({
        severity: 'info',
        code: 'model-unknown',
        nodeName: requirement.nodeName,
        message: `Le modèle « ${model} » est absent du catalogue : ni tarif ni jugement possibles.`,
        data: {
          ...base,
          suggestion:
            'Ajouter sa ligne dans le catalogue des modèles pour que coûts et audit le prennent en compte.',
        },
      });
      continue;
    }

    findings.push(...aptitudeFindings(requirement, entry, usage, thresholds, base));
    if (stale) continue;
    findings.push(...lifecycleFindings(entry, requirement, base, now));
    findings.push(...oversizedFinding(input, requirement, entry, base, thresholds));
    findings.push(...economyFindings(input, requirement, entry, usage, thresholds, base));
  }
  return findings;
}

/**
 * La moitié STRUCTURELLE du gâchis : un modèle de raisonnement là où la
 * plomberie ne demande rien. Elle ne voit que le câblage, et reste donc muette
 * sur une chaîne de traduction — c'est `model-task-oversized` qui la voit, et
 * quand celui-ci a de quoi parler, celui-là se tait pour ne pas dire deux fois
 * la même chose sur le même nœud.
 */
function oversizedFinding(
  input: ModelAuditInput,
  requirement: LlmNodeRequirement,
  entry: ModelCatalogEntry,
  base: Record<string, unknown>,
  thresholds: ModelAuditThresholds,
): CheckFinding[] {
  if (entry.tier !== 'reasoning') return [];
  if (requirement.needsVision || requirement.needsTools || requirement.needsStructuredOutput) return [];
  if (taskOf(input, requirement, thresholds)) return [];
  return [
    {
      severity: 'info',
      code: 'model-oversized',
      nodeName: requirement.nodeName,
      message: `« ${entry.pattern} » est un modèle de raisonnement, et rien ici ne demande d’outils, d’images ni de long contexte.`,
      data: {
        ...base,
        catalogPattern: entry.pattern,
        currentTier: entry.tier,
        suggestion:
          'Vérifier qu’un modèle plus léger ne suffirait pas : le raisonnement se paie à chaque appel.',
      },
    },
  ];
}

/** Axe A — le modèle sait-il faire ce que le nœud lui demande ? */
function aptitudeFindings(
  requirement: LlmNodeRequirement,
  entry: ModelCatalogEntry,
  usage: LlmNodeUsage | undefined,
  thresholds: ModelAuditThresholds,
  base: Record<string, unknown>,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const data = { ...base, catalogPattern: entry.pattern };

  // Une aptitude inconnue (`null`) fait TAIRE le contrôle : un trou de la
  // description n'est pas une faute du workflow.
  if (requirement.needsVision && entry.supportsVision === false) {
    findings.push({
      severity: 'error',
      code: 'model-missing-vision',
      nodeName: requirement.nodeName,
      message: `Une image est envoyée à « ${entry.pattern} », qui ne sait pas la lire.`,
      data: {
        ...data,
        requirement: 'vision',
        suggestion: 'Choisir un modèle qui accepte les images, ou retirer l’entrée image de la chaîne.',
      },
    });
  }
  if (requirement.needsTools && entry.supportsTools === false) {
    findings.push({
      severity: 'error',
      code: 'model-missing-tools',
      nodeName: requirement.nodeName,
      message: `L’agent porte des outils mais « ${entry.pattern} » ne sait pas les appeler : il tournera sans jamais en utiliser un.`,
      data: { ...data, requirement: 'tools', suggestion: 'Choisir un modèle qui gère l’appel d’outils.' },
    });
  }
  if (requirement.needsStructuredOutput && entry.supportsStructuredOutput === false) {
    findings.push({
      severity: 'warning',
      code: 'model-missing-structured-output',
      nodeName: requirement.nodeName,
      message: `Un parser structuré est branché derrière « ${entry.pattern} », qui ne garantit pas la forme de sa sortie.`,
      data: {
        ...data,
        requirement: 'structuredOutput',
        suggestion: 'Choisir un modèle à sortie contrainte, ou accepter le repli sur un parsing best-effort.',
      },
    });
  }

  // Mesuré, jamais estimé : le prompt d'un agent contient l'historique, les
  // descriptions d'outils et les documents récupérés — rien de tout ça n'est
  // dans le JSON.
  if (usage && entry.contextWindow) {
    const limit = entry.contextWindow * thresholds.contextHeadroom;
    if (usage.promptTokensP95 > limit) {
      findings.push({
        severity: 'warning',
        code: 'model-context-too-small',
        nodeName: requirement.nodeName,
        message: `Les entrées mesurées (p95 : ${Math.round(usage.promptTokensP95).toLocaleString('fr-FR')} tokens) frôlent la fenêtre de « ${entry.pattern} » (${entry.contextWindow.toLocaleString('fr-FR')}).`,
        data: {
          ...data,
          p95: Math.round(usage.promptTokensP95),
          contextWindow: entry.contextWindow,
          suggestion:
            'Passer à un modèle à fenêtre plus large, ou réduire ce qui est injecté dans le prompt.',
        },
      });
    }
  }
  return findings;
}

/** Axe B — le modèle est-il encore là ? */
function lifecycleFindings(
  entry: ModelCatalogEntry,
  requirement: LlmNodeRequirement,
  base: Record<string, unknown>,
  now: Date,
): CheckFinding[] {
  const successor = entry.replacedByPattern ? ` Successeur annoncé : ${entry.replacedByPattern}.` : '';
  const data = {
    ...base,
    catalogPattern: entry.pattern,
    status: entry.status,
    retiresAt: entry.retiresAt ?? null,
    replacedByPattern: entry.replacedByPattern ?? null,
  };

  if (entry.status === 'retired') {
    return [
      {
        severity: 'error',
        code: 'model-retired',
        nodeName: requirement.nodeName,
        message: `« ${entry.pattern} » est retiré : l’appel échoue, ou échouera au prochain passage.${successor}`,
        data: {
          ...data,
          suggestion: entry.replacedByPattern
            ? `Basculer vers ${entry.replacedByPattern}.`
            : 'Choisir un modèle encore servi par le provider.',
        },
      },
    ];
  }
  if (entry.status === 'deprecated') {
    const deadline = entry.retiresAt ? ` Retrait annoncé le ${formatDate(entry.retiresAt)}.` : '';
    const soon = entry.retiresAt ? new Date(entry.retiresAt).getTime() - now.getTime() : null;
    return [
      {
        severity: 'warning',
        code: 'model-deprecated',
        nodeName: requirement.nodeName,
        message: `« ${entry.pattern} » est déprécié.${deadline}${successor}`,
        data: {
          ...data,
          daysLeft: soon === null ? null : Math.round(soon / 86_400_000),
          suggestion: entry.replacedByPattern
            ? `Basculer vers ${entry.replacedByPattern} avant l’échéance.`
            : 'Prévoir la bascule avant le retrait.',
        },
      },
    ];
  }
  return [];
}

/** Axes B et C — payé trop cher, à tier conservé (sûr) ou pour la tâche (à discuter). */
function economyFindings(
  input: ModelAuditInput,
  requirement: LlmNodeRequirement,
  entry: ModelCatalogEntry,
  usage: LlmNodeUsage | undefined,
  thresholds: ModelAuditThresholds,
  base: Record<string, unknown>,
): CheckFinding[] {
  // Une économie théorique sur un workflow qui ne tourne pas est du bruit :
  // sans usage mesuré, elle vit sur l'écran de parc, pas dans un finding.
  if (!usage || usage.calls === 0) return [];
  const mix: ModelUsageMix = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    days: usage.days,
  };

  const needs: ModelNeeds = {
    vision: requirement.needsVision,
    tools: requirement.needsTools,
    structuredOutput: requirement.needsStructuredOutput,
    minContext:
      usage.promptTokensP95 > 0 ? Math.ceil(usage.promptTokensP95 / thresholds.contextHeadroom) : null,
    minTier: entry.tier,
  };

  const findings: CheckFinding[] = [];
  const task = taskOf(input, requirement, thresholds);

  // Axe C d'abord : la tâche peut autoriser une DESCENTE de tier, ce que la
  // règle sûre s'interdit. Quand elle parle, elle dit tout ce que l'autre
  // aurait dit, en mieux — inutile de crier deux fois sur le même nœud.
  if (task) {
    const floor = input.taskProfiles?.[task.task];
    if (floor && tierRank(floor) < tierRank(entry.tier)) {
      const candidate = bestCandidate(
        entry,
        input.catalog,
        { ...needs, minTier: floor, task: task.task },
        { sameProvider: true, usage: mix },
      );
      if (candidate && worthSaying(candidate.savings.pct, candidate.savings.annualUsd, thresholds)) {
        findings.push({
          severity: 'info',
          code: 'model-task-oversized',
          nodeName: requirement.nodeName,
          message: `${labelOf(task.task)} : un modèle plus léger suffit. ${entry.pattern} → ${candidate.entry.pattern}, −${candidate.savings.pct} % sur le tarif${candidate.savings.annualUsd !== null ? `, ~${candidate.savings.annualUsd} $/an aux volumes mesurés` : ''}. À vérifier sur un cas de test avant bascule.`,
          data: {
            ...base,
            catalogPattern: entry.pattern,
            task: task.task,
            taskConfidence: task.confidence,
            taskEvidence: task.evidence ?? null,
            taskSource: task.source,
            currentTier: entry.tier,
            requiredTier: floor,
            candidate: candidate.entry.pattern,
            savingsPct: candidate.savings.pct,
            savingsAnnualUsd: candidate.savings.annualUsd,
            suggestion: `Basculer vers ${candidate.entry.pattern}, puis rejouer un cas de test : une descente de gamme change la sortie, elle ne se pose pas à l’aveugle.`,
          },
        });
        return findings;
      }
    }
  }

  // Axe B : à tier CONSERVÉ, donc rien ne peut se dégrader.
  const sameProvider = bestCandidate(entry, input.catalog, needs, { sameProvider: true, usage: mix });
  if (sameProvider && worthSaying(sameProvider.savings.pct, sameProvider.savings.annualUsd, thresholds)) {
    findings.push(cheaperFinding('model-cheaper-alternative', requirement, entry, sameProvider, base, false));
    return findings;
  }
  const otherProvider = bestCandidate(entry, input.catalog, needs, { sameProvider: false, usage: mix });
  if (otherProvider && worthSaying(otherProvider.savings.pct, otherProvider.savings.annualUsd, thresholds)) {
    findings.push(cheaperFinding('model-cheaper-provider', requirement, entry, otherProvider, base, true));
  }
  return findings;
}

function cheaperFinding(
  code: string,
  requirement: LlmNodeRequirement,
  entry: ModelCatalogEntry,
  candidate: { entry: ModelCatalogEntry; savings: { pct: number; annualUsd: number | null } },
  base: Record<string, unknown>,
  crossProvider: boolean,
): CheckFinding {
  const money =
    candidate.savings.annualUsd !== null ? `, ~${candidate.savings.annualUsd} $/an aux volumes mesurés` : '';
  return {
    severity: 'info',
    code,
    nodeName: requirement.nodeName,
    message: crossProvider
      ? `Chez un autre provider, ${candidate.entry.pattern} (${candidate.entry.provider}) rend le même service pour −${candidate.savings.pct} %${money}.`
      : `${candidate.entry.pattern} a les mêmes aptitudes et le même niveau pour −${candidate.savings.pct} %${money}.`,
    data: {
      ...base,
      catalogPattern: entry.pattern,
      candidate: candidate.entry.pattern,
      candidateProvider: candidate.entry.provider,
      savingsPct: candidate.savings.pct,
      savingsAnnualUsd: candidate.savings.annualUsd,
      suggestion: crossProvider
        ? 'Changer de provider est un autre nœud, une autre credential et un prompt à recaler : à évaluer, pas à appliquer d’un clic.'
        : `Basculer vers ${candidate.entry.pattern} : niveau et aptitudes conservés.`,
    },
  };
}

/** Une classification exploitable : humaine sans condition, IA au-dessus du seuil. */
function taskOf(
  input: ModelAuditInput,
  requirement: LlmNodeRequirement,
  thresholds: ModelAuditThresholds,
): LlmNodeTaskVerdict | null {
  const verdict = input.taskByNode?.[requirement.nodeName];
  if (!verdict || verdict.task === 'unknown') return null;
  if (verdict.source === 'manual') return verdict;
  return verdict.confidence >= thresholds.minTaskConfidence ? verdict : null;
}

function worthSaying(pct: number, annualUsd: number | null, thresholds: ModelAuditThresholds): boolean {
  if (pct < thresholds.savingsThresholdPct) return false;
  if (annualUsd !== null && annualUsd < thresholds.minAnnualSavingsUsd) return false;
  return true;
}

const TASK_LABELS: Record<string, string> = {
  translation: 'Traduction',
  classification: 'Classification',
  extraction: 'Extraction de données',
  summarization: 'Résumé',
  rewriting: 'Réécriture',
  generation: 'Rédaction',
  code: 'Code',
  reasoning: 'Raisonnement',
  conversation: 'Conversation',
};

function labelOf(task: string): string {
  return TASK_LABELS[task] ?? task;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
