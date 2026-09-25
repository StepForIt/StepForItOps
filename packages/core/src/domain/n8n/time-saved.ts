/**
 * Combien de minutes de travail humain une exécution réussie remplace, ESTIMÉ
 * depuis le contenu du workflow.
 *
 * Le champ « temps gagné » était saisi à la main, workflow par workflow : sur un
 * parc de cent workflows personne ne le remplit, et le ROI du dashboard restait
 * à zéro pour tout le monde. Une estimation par défaut vaut mieux qu'un blanc —
 * à condition d'être ANNONCÉE comme telle et de céder la place dès qu'un humain
 * pose son chiffre.
 *
 * Le raisonnement est celui du geste remplacé : on ne compte pas les nœuds, on
 * compte ce qu'il aurait fallu FAIRE à la main — ouvrir l'outil et retrouver la
 * donnée, saisir une ligne, rédiger un message, relire et décider. La plomberie
 * (Set, IF, Merge, boucle) n'est pas un geste : elle n'existe que parce que le
 * travail est automatisé.
 *
 * Un appel de sous-workflow ne compte pour RIEN ici : le sous-workflow a ses
 * propres exécutions, donc sa propre estimation, et les additionner compterait
 * deux fois le même travail dans le total du dashboard.
 */
import { N8nNode, N8nWorkflow } from './workflow.types';
import { classifySideEffect } from './side-effect-nodes';
import { isStickyNote, isTriggerNode } from './workflow-graph';

/** Le geste humain qu'un nœud remplace, et ce qu'il coûte en minutes. */
export type SavedGesture = 'write' | 'send' | 'read' | 'think' | 'decide' | 'transform';

/**
 * Minutes par geste. Volontairement grossier : la précision viendrait d'une
 * mesure qu'on n'a pas, et un chiffre à la décimale près donnerait une confiance
 * que l'estimation ne mérite pas.
 */
const MINUTES: Record<SavedGesture, number> = {
  /** Saisir une ligne, créer une fiche, mettre à jour un enregistrement. */
  write: 3,
  /** Rédiger et envoyer un message ou un e-mail. */
  send: 3,
  /** Ouvrir l'outil, retrouver la donnée, la recopier. */
  read: 2,
  /** Ce qu'un modèle rédige ou analyse : le geste le plus cher à la main. */
  think: 5,
  /** Regarder une valeur et choisir la suite. */
  decide: 0.5,
  /** Remettre en forme, recalculer, recopier d'un format à l'autre. */
  transform: 1,
};

/**
 * Plafond : au-delà, l'estimation dit surtout que le workflow est gros. Un
 * chiffre à trois heures par exécution passerait pour une mesure et gonflerait
 * le ROI d'un facteur qu'on ne saurait pas défendre.
 */
const MAX_MINUTES = 120;

/**
 * Types qui n'existent que parce que le travail est automatisé : personne ne
 * « fait un Merge » à la main. Comparés en minuscules, sur la fin du type
 * (`n8n-nodes-base.set` → `set`).
 */
const PLUMBING = new Set([
  'set',
  'noop',
  'merge',
  'splitinbatches',
  'splitout',
  'aggregate',
  'itemlists',
  'limit',
  'sort',
  'removeduplicates',
  'renamekeys',
  'wait',
  'stopanderror',
  'respondtowebhook',
  'executeworkflow',
  'toolworkflow',
  'executiondata',
  'debughelper',
  'n8n',
]);

const DECIDING = new Set(['if', 'switch', 'filter']);
const TRANSFORMING = new Set([
  'code',
  'function',
  'functionitem',
  'datetime',
  'html',
  'xml',
  'markdown',
  'crypto',
  'extractfromfile',
  'converttofile',
  'compression',
]);

export interface TimeSavedBreakdownLine {
  gesture: SavedGesture;
  nodes: string[];
  minutes: number;
}

export interface TimeSavedEstimate {
  /** Minutes de travail manuel par exécution réussie, arrondies à la demi-minute. */
  minutes: number;
  /** Une phrase : sur quoi repose le chiffre, pour que l'humain puisse le corriger en connaissance de cause. */
  reason: string;
  breakdown: TimeSavedBreakdownLine[];
  /** Vrai quand le plafond a mordu : le chiffre rendu est un plancher. */
  capped: boolean;
}

/** Le suffixe du type, sans son paquet : `@n8n/n8n-nodes-langchain.agent` → `agent`. */
function shortType(node: N8nNode): string {
  const type = node.type.toLowerCase();
  return type.slice(type.lastIndexOf('.') + 1);
}

function gestureOf(node: N8nNode): SavedGesture | null {
  const type = node.type.toLowerCase();
  const short = shortType(node);

  // Un déclencheur n'est pas un geste : c'est l'événement qui aurait de toute
  // façon eu lieu (le mail arrive, l'heure tourne).
  if (isTriggerNode(node) || isStickyNote(node)) return null;
  if (PLUMBING.has(short)) return null;

  // Modèles et agents : le nœud rédige, classe ou résume — à la main, c'est le
  // geste le plus long. Les sous-nœuds (embeddings, mémoire, outils) ne sont que
  // le câblage de celui-là.
  if (type.includes('langchain')) {
    return short.startsWith('lm') || short.includes('agent') || short.includes('chain') ? 'think' : null;
  }

  if (DECIDING.has(short)) return 'decide';
  if (TRANSFORMING.has(short)) return 'transform';

  // Ce qui SORT du système est déjà classé pour les bouchons de test : on
  // réutilise ce verdict plutôt que d'en tenir un second, qui divergerait.
  const effect = classifySideEffect(node);
  if (effect) {
    if (effect.kind === 'sub-workflow') return null; // compté chez l'appelé
    return effect.kind === 'email' || effect.kind === 'message' ? 'send' : 'write';
  }

  // Reste : un nœud d'application qui n'écrit pas — il lit. C'est le cas le plus
  // fréquent (search, get, list), et le seul geste qu'on lui prête est d'aller
  // chercher la donnée là où elle vit.
  return 'read';
}

/** Singulier et pluriel : « 1 écriture, 3 lectures » se relit, « 3 lectures » écrit à la main non. */
const LABELS: Record<SavedGesture, [string, string]> = {
  write: ['écriture', 'écritures'],
  send: ['envoi', 'envois'],
  read: ['lecture', 'lectures'],
  think: ['passage IA', 'passages IA'],
  decide: ['décision', 'décisions'],
  transform: ['mise en forme', 'mises en forme'],
};

/**
 * L'estimation déterministe. Pure, sans IA : c'est la valeur par défaut de tout
 * le parc, et elle sert aussi de repli quand l'affinage par IA n'est pas
 * disponible — le ROI ne doit pas dépendre d'une clé API.
 */
export function estimateTimeSaved(workflow: N8nWorkflow): TimeSavedEstimate {
  const lines = new Map<SavedGesture, TimeSavedBreakdownLine>();
  for (const node of workflow.nodes ?? []) {
    if (node.disabled) continue;
    const gesture = gestureOf(node);
    if (!gesture) continue;
    const line = lines.get(gesture) ?? { gesture, nodes: [], minutes: 0 };
    line.nodes.push(node.name);
    line.minutes += MINUTES[gesture];
    lines.set(gesture, line);
  }

  const breakdown = [...lines.values()].sort((a, b) => b.minutes - a.minutes);
  const raw = breakdown.reduce((total, line) => total + line.minutes, 0);
  const capped = raw > MAX_MINUTES;
  const minutes = Math.round(Math.min(raw, MAX_MINUTES) * 2) / 2;

  if (minutes === 0) {
    return {
      minutes: 0,
      reason:
        "Aucun geste humain remplacé n'a été reconnu : le workflow n'est que du câblage, ou ses nœuds sont désactivés.",
      breakdown,
      capped: false,
    };
  }

  const detail = breakdown
    .map((line) => `${line.nodes.length} ${LABELS[line.gesture][line.nodes.length > 1 ? 1 : 0]}`)
    .join(', ');
  return {
    minutes,
    reason: capped
      ? `${detail} — plafonné à ${MAX_MINUTES} min : au-delà, l'estimation ne dirait plus que la taille du workflow.`
      : `${detail}.`,
    breakdown,
    capped,
  };
}
