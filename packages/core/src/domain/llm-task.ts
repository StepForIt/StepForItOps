import { createHash } from 'crypto';
import { ModelTier } from './model-catalog';

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

export const LLM_TASK_LABELS: Record<LlmTask, string> = {
  translation: 'Traduction',
  classification: 'Classification',
  extraction: 'Extraction de données',
  summarization: 'Résumé',
  rewriting: 'Réécriture',
  generation: 'Rédaction / génération',
  code: 'Code',
  reasoning: 'Raisonnement en plusieurs étapes',
  conversation: 'Conversation',
  unknown: 'Indéterminée',
};

/**
 * Planchers par défaut. Des positions défendables, pas des mesures : elles sont
 * livrées, éditables, et portent leur justification à l'écran.
 */
export const DEFAULT_TASK_PROFILES: Array<{ task: LlmTask; minTier: ModelTier; rationale: string }> = [
  {
    task: 'translation',
    minTier: 'light',
    rationale:
      'La traduction est la tâche la mieux servie par les petits modèles : le sens est dans la source, pas dans le raisonnement.',
  },
  {
    task: 'classification',
    minTier: 'light',
    rationale:
      'Choisir une étiquette dans une liste fermée ne demande pas de raisonnement en plusieurs étapes.',
  },
  {
    task: 'extraction',
    minTier: 'light',
    rationale:
      "Retrouver des champs dans un texte : la difficulté est le format de sortie, pas l'intelligence.",
  },
  {
    task: 'summarization',
    minTier: 'light',
    rationale:
      'Un résumé fidèle est à la portée des petits modèles ; la longueur du contexte compte davantage que le tier.',
  },
  {
    task: 'rewriting',
    minTier: 'light',
    rationale: 'Reformuler à consigne donnée reste une transformation de surface.',
  },
  {
    task: 'generation',
    minTier: 'standard',
    rationale:
      'La rédaction pour un lecteur externe se juge sur le style : le tier intermédiaire est le premier qui tienne.',
  },
  {
    task: 'conversation',
    minTier: 'standard',
    rationale: "Un échange multi-tours doit tenir le fil ; c'est là que les modèles légers décrochent.",
  },
  { task: 'code', minTier: 'standard', rationale: 'Du code faux coûte plus cher que le modèle économisé.' },
  {
    task: 'reasoning',
    minTier: 'reasoning',
    rationale: 'Enchaîner des déductions est exactement ce pour quoi ces modèles existent.',
  },
  {
    task: 'unknown',
    minTier: 'reasoning',
    rationale: 'Tâche non classée : on ne propose aucune descente de gamme, faute de savoir ce qui se joue.',
  },
];

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
