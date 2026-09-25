import { ModelPriceEntry, matchModelPrice } from './n8n/llm-pricing';

/**
 * Ce que la plateforme sait d'un modèle de langage : son tarif (déjà là), et ce
 * qui manquait — son cycle de vie et ses aptitudes.
 *
 * Neutre par nature : rien ici ne connaît n8n, et un scénario Make alimentera
 * les mêmes règles le jour où on le lira.
 *
 * Une aptitude vaut `null` quand on ne la connaît PAS, et c'est le point qui
 * décide de la qualité de l'audit : un trou de la description n'est pas une
 * faute du workflow. Le contrôle correspondant se tait, il n'échoue pas.
 */

export type ModelStatus = 'active' | 'preview' | 'deprecated' | 'retired';

/**
 * Le seul jugement de « puissance » que la plateforme porte, et il vient de la
 * table — jamais d'une mesure d'ici, jamais de l'avis d'un modèle.
 */
export type ModelTier = 'light' | 'standard' | 'reasoning';

const TIER_RANK: Record<ModelTier, number> = { light: 0, standard: 1, reasoning: 2 };

export function tierRank(tier: ModelTier): number {
  return TIER_RANK[tier] ?? 1;
}

export function isTierAtLeast(tier: ModelTier, floor: ModelTier): boolean {
  return tierRank(tier) >= tierRank(floor);
}

export function asTier(value: unknown): ModelTier {
  return value === 'light' || value === 'reasoning' ? value : 'standard';
}

export function asModelStatus(value: unknown): ModelStatus {
  return value === 'preview' || value === 'deprecated' || value === 'retired' ? value : 'active';
}

export interface ModelCatalogEntry extends ModelPriceEntry {
  provider: string;
  status: ModelStatus;
  /** Date de retrait ANNONCÉE ; null = pas d'échéance connue. ISO. */
  retiresAt?: string | null;
  /** Successeur recommandé, en `pattern` de ce même catalogue. */
  replacedByPattern?: string | null;
  tier: ModelTier;
  /** null = on ne sait pas. Jamais `false` par défaut. */
  supportsVision?: boolean | null;
  supportsTools?: boolean | null;
  supportsStructuredOutput?: boolean | null;
  contextWindow?: number | null;
  /** Exceptions nommées à la main : « ce modèle dément son tier sur ces tâches ». */
  weakAtTasks?: string[];
}

/** Même correspondance que la tarification : exact, puis le préfixe le plus long. */
export function matchModelCatalog(
  model: string | null,
  entries: ModelCatalogEntry[],
): ModelCatalogEntry | null {
  return matchModelPrice(model, entries);
}

/** Ce qu'un nœud exige d'un modèle pour tourner correctement. */
export interface ModelNeeds {
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  /** Tokens d'entrée à couvrir (p95 MESURÉ) ; null = pas de mesure, pas d'exigence. */
  minContext: number | null;
  /** Plancher de tier : celui du modèle en place, ou celui que la tâche impose. */
  minTier: ModelTier;
  /** Tâche du nœud, quand elle est connue : sert aux exceptions `weakAtTasks`. */
  task?: string | null;
}

/**
 * Un candidat n'est retenu que s'il COUVRE le besoin. Une aptitude inconnue
 * disqualifie : on ne recommande pas ce qu'on ne connaît pas — c'est l'inverse
 * exact de la règle de silence appliquée au modèle DÉJÀ en place.
 */
export function coversNeeds(entry: ModelCatalogEntry, needs: ModelNeeds): boolean {
  if (entry.status === 'retired' || entry.status === 'deprecated') return false;
  if (needs.vision && entry.supportsVision !== true) return false;
  if (needs.tools && entry.supportsTools !== true) return false;
  if (needs.structuredOutput && entry.supportsStructuredOutput !== true) return false;
  if (needs.minContext !== null && (entry.contextWindow ?? 0) < needs.minContext) return false;
  if (!isTierAtLeast(entry.tier, needs.minTier)) return false;
  if (needs.task && (entry.weakAtTasks ?? []).includes(needs.task)) return false;
  return true;
}

/** Le mix de tokens observé, quand il existe : c'est lui qui rend une économie chiffrable. */
export interface ModelUsageMix {
  promptTokens: number;
  completionTokens: number;
  /** Fenêtre d'observation, pour extrapoler à l'année sans supposer 30 jours. */
  days: number;
}

export interface ModelSavings {
  /** Écart de tarif en %, positif = moins cher. */
  pct: number;
  /** Économie annualisée en USD ; null quand aucun usage n'a été mesuré. */
  annualUsd: number | null;
  /** true quand le % vient d'un mix mesuré plutôt que d'une double baisse de tarif. */
  measured: boolean;
}

const DAYS_PER_YEAR = 365;

/**
 * L'économie d'une bascule.
 *
 * Avec un usage mesuré : les tokens réellement consommés, revalorisés au tarif
 * du candidat. Sans usage : on n'annonce un pourcentage que si **input ET
 * output** baissent tous les deux — sinon le chiffre dépend du mix, qu'on ne
 * connaît pas, et l'annonce serait un tirage au sort.
 */
export function modelSavings(
  current: ModelPriceEntry,
  candidate: ModelPriceEntry,
  usage?: ModelUsageMix | null,
): ModelSavings | null {
  if (usage && usage.days > 0 && usage.promptTokens + usage.completionTokens > 0) {
    const before = cost(current, usage);
    const after = cost(candidate, usage);
    if (before <= 0 || after >= before) return null;
    const perDay = (before - after) / usage.days;
    return {
      pct: round((1 - after / before) * 100),
      annualUsd: round(perDay * DAYS_PER_YEAR),
      measured: true,
    };
  }
  if (candidate.inputPerMTok >= current.inputPerMTok || candidate.outputPerMTok >= current.outputPerMTok) {
    return null;
  }
  const inputPct = 1 - candidate.inputPerMTok / current.inputPerMTok;
  const outputPct = 1 - candidate.outputPerMTok / current.outputPerMTok;
  return { pct: round(Math.min(inputPct, outputPct) * 100), annualUsd: null, measured: false };
}

function cost(price: ModelPriceEntry, usage: ModelUsageMix): number {
  return (usage.promptTokens * price.inputPerMTok + usage.completionTokens * price.outputPerMTok) / 1_000_000;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Le meilleur candidat : le MOINS CHER qui couvre le besoin, jamais une liste —
 * un finding qui ouvre un comparatif ne se traite pas, il se referme.
 */
export function bestCandidate(
  current: ModelCatalogEntry,
  catalog: ModelCatalogEntry[],
  needs: ModelNeeds,
  options: { sameProvider: boolean; usage?: ModelUsageMix | null },
): { entry: ModelCatalogEntry; savings: ModelSavings } | null {
  let best: { entry: ModelCatalogEntry; savings: ModelSavings } | null = null;
  for (const entry of catalog) {
    if (entry.pattern === current.pattern) continue;
    if (options.sameProvider !== (entry.provider === current.provider)) continue;
    if (!coversNeeds(entry, needs)) continue;
    const savings = modelSavings(current, entry, options.usage);
    if (!savings) continue;
    if (!best || savings.pct > best.savings.pct) best = { entry, savings };
  }
  return best;
}

/** Un alias qui bouge sous les pieds du workflow sans qu'il change. */
export function isFloatingAlias(model: string): boolean {
  return /(^|[-:_ ])latest$/i.test(model.trim());
}
