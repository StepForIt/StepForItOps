import { createHash } from 'crypto';
import { ModelTier } from './model-catalog';
import { MessageId, msg } from '../i18n/translate';

/**
 * La TÂCHE d'un nœud LLM : ce que la structure ne dit pas.
 *
 * Un Chat Model qui traduit ne demande ni outils, ni vision, ni long contexte —
 * rien dans la plomberie ne trahit qu'un modèle de raisonnement y fait le
 * travail d'un modèle léger. La tâche vit dans le prompt, en français, et c'est
 * la seule information de cet audit qui ne se déduise d'aucune structure.
 *
 * Deux choses SÉPARÉES ici, et c'est tout le sujet :
 * - nommer la tâche (jugement sur du langage naturel : c'est l'IA, liste fermée) ;
 * - décider ce qu'elle exige (une table éditable, pas une opinion de modèle —
 *   sinon le verdict change à chaque passe et personne ne peut le contredire).
 */

export const LLM_TASKS = [
  'translation',
  'classification',
  'extraction',
  'summarization',
  'rewriting',
  'generation',
  'code',
  'reasoning',
  'conversation',
  'unknown',
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

export function asLlmTask(value: unknown): LlmTask {
  return typeof value === 'string' && (LLM_TASKS as readonly string[]).includes(value)
    ? (value as LlmTask)
    : 'unknown';
}

/** Le libellé d'une tâche, dans la langue courante. */
export function llmTaskLabel(task: LlmTask): string {
  return msg('analysis.taskLabel', { task });
}

const TASK_RATIONALES: Record<LlmTask, MessageId> = {
  translation: 'analysis.taskRationaleTranslation',
  classification: 'analysis.taskRationaleClassification',
  extraction: 'analysis.taskRationaleExtraction',
  summarization: 'analysis.taskRationaleSummarization',
  rewriting: 'analysis.taskRationaleRewriting',
  generation: 'analysis.taskRationaleGeneration',
  code: 'analysis.taskRationaleCode',
  reasoning: 'analysis.taskRationaleReasoning',
  conversation: 'analysis.taskRationaleConversation',
  unknown: 'analysis.taskRationaleUnknown',
};

const DEFAULT_TASK_TIERS: Array<{ task: LlmTask; minTier: ModelTier }> = [
  { task: 'translation', minTier: 'light' },
  { task: 'classification', minTier: 'light' },
  { task: 'extraction', minTier: 'light' },
  { task: 'summarization', minTier: 'light' },
  { task: 'rewriting', minTier: 'light' },
  { task: 'generation', minTier: 'standard' },
  { task: 'conversation', minTier: 'standard' },
  { task: 'code', minTier: 'standard' },
  { task: 'reasoning', minTier: 'reasoning' },
  { task: 'unknown', minTier: 'reasoning' },
];

/**
 * Planchers par défaut. Des positions défendables, pas des mesures : elles sont
 * livrées, éditables, et portent leur justification à l'écran.
 */
export function defaultTaskProfiles(): Array<{ task: LlmTask; minTier: ModelTier; rationale: string }> {
  return DEFAULT_TASK_TIERS.map((profile) => ({ ...profile, rationale: msg(TASK_RATIONALES[profile.task]) }));
}

/**
 * Empreinte de la classification : elle porte le GABARIT, jamais l'échantillon
 * d'exécution. Deux exécutions ne donnent jamais le même texte, et une
 * empreinte sur l'échantillon reclasserait le nœud à chaque passe — c'est-à-dire
 * un appel IA par nœud et par nuit pour redire la même étiquette.
 */
export function promptFingerprint(template: string): string {
  return createHash('sha256').update(template.trim()).digest('hex').slice(0, 32);
}

/**
 * Le gabarit dit-il assez pour classer sans lire une exécution ? Un prompt fait
 * surtout d'expressions (`={{ $json.consigne }}`) ne dit rien : le texte réel
 * n'existe qu'à l'exécution.
 */
export function templateIsTelling(template: string | null | undefined): boolean {
  if (!template) return false;
  const withoutExpressions = template.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  const words = withoutExpressions.split(/\s+/).filter((word) => word.length > 2);
  return words.length >= 8;
}
