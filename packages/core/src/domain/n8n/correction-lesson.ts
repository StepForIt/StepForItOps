/**
 * Ce qu'on apprend quand l'humain corrige à la main ce que l'assistant a écrit.
 *
 * La plateforme garde déjà les deux moitiés de la paire : `WorkflowChatProposal.raw`
 * porte le workflow COMPLET tel que l'assistant l'a produit, et le snapshot de
 * `versioning` qui suit porte le même workflow tel que l'humain l'a laissé. Le
 * diff des deux n'est pas un diff ordinaire — c'est une copie rendue avec la
 * correction à côté, le seul signal où l'erreur est nommée par quelqu'un qui
 * savait. Il était calculé et jeté : `sync_workflow` s'en servait pour dire « le
 * workflow a bougé », rien de plus.
 *
 * Toute la difficulté est que le diff ne dit pas POURQUOI. « Je m'étais trompé »
 * et « j'ai changé d'avis » ont exactement la même forme, et en tirer une règle
 * générale apprendrait du faux avec l'aplomb du vrai. D'où trois discriminants,
 * du moins cher au plus cher, et qui se complètent :
 *
 * 1. LE STRUCTUREL SEUL S'APPREND. Une sous-clé renommée, une forme de paramètre
 *    changée, un champ apparu : le catalogue de nœuds sait arbitrer ça tout seul —
 *    c'était faux, ça ne l'est plus. Une VALEUR corrigée (un id, une limite, une
 *    url) n'est jamais une règle : c'est un fait, et `chat-memory` est fait pour ça.
 * 2. LA FENÊTRE BORNE LE SOUPÇON. Seuls les nœuds que la proposition a touchés, et
 *    seulement tant qu'aucune autre proposition n'est passée depuis. Au-delà, ce
 *    qu'on lirait est le travail de l'humain, pas la correction de l'assistant.
 * 3. CE QUI RESTE SE DEMANDE. Un nœud que l'humain a ajouté, un câblage refait,
 *    un gabarit remplacé : le déterminisme ne tranche pas, et une question d'une
 *    ligne au tour suivant vaut mieux qu'une inférence. C'est le seul moyen
 *    d'attraper les erreurs qu'aucun schéma ne voit.
 *
 * Rien ici ne fait d'IO ni d'appel IA : la lecture est pure, la formulation de la
 * leçon vient après (`lesson-distill.service.ts`).
 */

import { N8nNode, N8nWorkflow } from './workflow.types';
import { looksLikeExampleValue } from './placeholder-params';
import { isStickyNote } from './workflow-graph';

/** Nature du changement, telle qu'on sait la lire sans rien demander. */
export type CorrectionKind =
  /** La FORME a changé : clé apparue, disparue, renommée, ou type JSON différent. */
  | 'structural'
  /** Même clé, même type, autre valeur. Un fait, jamais une règle. */
  | 'value'
  /** Nœud ajouté/retiré par l'humain, ou câblage refait : un choix de montage. */
  | 'wiring';

export type CorrectionVerdict =
  /** S'apprend directement : un schéma aurait pu le dire. */
  | 'lesson'
  /** Ne se tranche pas tout seul : à demander à l'humain au tour suivant. */
  | 'ask'
  /** Hors fenêtre, hors périmètre, ou sans enseignement. */
  | 'ignore';

export interface CorrectionChange {
  node: string;
  nodeType: string;
  kind: CorrectionKind;
  verdict: CorrectionVerdict;
  /** Chemin du paramètre touché (`columns.value.Product Link`). Vide pour un montage. */
  path: string;
  /** Ce que l'assistant avait écrit, puis ce que l'humain a mis. Bornés court. */
  wrote: string;
  fixed: string;
  /** Pourquoi ce verdict — repris tel quel à l'écran et dans la question. */
  reason: string;
}

export interface CorrectionReading {
  /** Tout ce qu'on a lu, verdicts compris : c'est ce qui s'affiche. */
  changes: CorrectionChange[];
  /** Ce qui part en distillation sans rien demander. */
  lessons: CorrectionChange[];
  /** Ce sur quoi on interrogera l'humain. */
  questions: CorrectionChange[];
  /** Rien à apprendre : ni leçon ni question. */
  empty: boolean;
}

export interface CorrectionInput {
  /** Le workflow tel que l'assistant l'a écrit (`WorkflowChatProposal.raw`). */
  wrote: N8nWorkflow;
  /** Le même workflow tel que l'humain l'a laissé (snapshot suivant). */
  fixed: N8nWorkflow;
  /** Nœuds que la proposition a touchés : hors d'eux, on ne soupçonne rien. */
  touchedNodes: string[];
  /** La proposition touchait-elle au câblage ? Sinon un câblage changé n'est pas sa faute. */
  touchedConnections?: boolean;
}

/**
 * Au-delà, la correction n'est plus attribuable : entre l'écriture et le
 * snapshot, l'humain a eu le temps de faire tout autre chose. Six heures couvrent
 * une session de travail sans avaler le lendemain — c'est aussi le garde
 * anti-backfill de `notifier`, pour la même raison.
 */
export const CORRECTION_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * La correction est-elle assez proche de l'écriture pour lui être imputée ?
 *
 * Le second garde-fou — aucune autre proposition appliquée entre les deux — se
 * vérifie en base et non ici : il demande de connaître les autres propositions.
 */
export function isWithinCorrectionWindow(appliedAt: Date, correctedAt: Date): boolean {
  const delta = correctedAt.getTime() - appliedAt.getTime();
  return delta >= 0 && delta <= CORRECTION_WINDOW_MS;
}

/**
 * Clés du nœud qu'on ne lit jamais comme une correction.
 *
 * `position` bouge dès que quelqu'un déplace une boîte, `notes` est du commentaire
 * humain, `id` et `webhookId` sont l'identité de l'exemplaire. Les prendre pour
 * des corrections ferait du bruit à chaque ouverture de l'éditeur.
 */
const IGNORED_NODE_FIELDS = new Set(['position', 'notes', 'notesInFlow', 'id', 'webhookId']);

/** Réglages du nœud (hors `parameters`) dont l'oubli est une vraie erreur d'assistant. */
const SETTING_FIELDS = ['disabled', 'onError', 'retryOnFail', 'maxTries', 'alwaysOutputData'] as const;

/** Un extrait de valeur, assez pour reconnaître, trop court pour recopier un nœud. */
function excerpt(value: unknown): string {
  if (value === undefined) return '(absent)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return '(absent)';
  return text.length <= 120 ? text : `${text.slice(0, 117)}…`;
}

/** Le type JSON, au grain qui nous intéresse : c'est lui qui distingue forme et valeur. */
function jsonKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

interface LeafChange {
  path: string;
  wrote: unknown;
  fixed: unknown;
  kind: CorrectionKind;
}

/**
 * Compare deux objets de paramètres et rend les feuilles qui diffèrent, chacune
 * déjà qualifiée en forme ou en valeur.
 *
 * La descente est RÉCURSIVE et s'arrête à la première divergence de forme : quand
 * un objet remplace une chaîne, détailler ses sous-clés produirait dix changements
 * pour une seule erreur — celle d'avoir mis une chaîne.
 */
function compareValues(wrote: unknown, fixed: unknown, path: string): LeafChange[] {
  if (JSON.stringify(wrote) === JSON.stringify(fixed)) return [];

  const wroteKind = jsonKind(wrote);
  const fixedKind = jsonKind(fixed);
  if (wroteKind !== fixedKind) {
    return [{ path, wrote, fixed, kind: 'structural' }];
  }

  if (wroteKind === 'array') {
    const a = wrote as unknown[];
    const b = fixed as unknown[];
    // Une longueur qui change est une forme : une entrée de collection est
    // apparue ou a disparu, ce n'est pas la valeur d'un champ qui bouge.
    if (a.length !== b.length) return [{ path, wrote, fixed, kind: 'structural' }];
    return a.flatMap((item, index) => compareValues(item, b[index], `${path}[${index}]`));
  }

  if (wroteKind === 'object') {
    const a = wrote as Record<string, unknown>;
    const b = fixed as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changes: LeafChange[] = [];
    for (const key of keys) {
      const at = path ? `${path}.${key}` : key;
      // Clé apparue ou disparue : c'est exactement ce que le schéma d'un nœud
      // sait arbitrer, et ce qui rend un workflow inouvrable dans n8n.
      if (!(key in a) || !(key in b)) {
        changes.push({ path: at, wrote: a[key], fixed: b[key], kind: 'structural' });
        continue;
      }
      changes.push(...compareValues(a[key], b[key], at));
    }
    return changes;
  }

  return [{ path, wrote, fixed, kind: 'value' }];
}

/**
 * Le verdict d'un changement de valeur.
 *
 * Par défaut on n'en tire rien : une limite passée de 50 à 100 n'apprend rien à
 * personne. L'exception est le gabarit — l'assistant avait posé `YOUR_API_KEY` ou
 * `example.com` là où il ne savait pas, et l'humain a mis la vraie valeur. Ça,
 * c'est une erreur, mais dont la LEÇON n'est pas la valeur (elle appartient au
 * workflow) : c'est « ne pose pas de gabarit, demande ». D'où la question.
 */
function verdictForValue(wrote: unknown, path: string): { verdict: CorrectionVerdict; reason: string } {
  if (typeof wrote === 'string' && looksLikeExampleValue(wrote)) {
    return {
      verdict: 'ask',
      reason:
        `Valeur d'exemple posée par l'assistant en ${path}, remplacée à la main : ` +
        'à confirmer comme erreur (une valeur inventée) plutôt que comme choix métier.',
    };
  }
  return {
    verdict: 'ignore',
    reason: `Changement de valeur en ${path} : un fait propre à ce workflow, pas une règle.`,
  };
}

function nodesByName(workflow: N8nWorkflow): Map<string, N8nNode> {
  const map = new Map<string, N8nNode>();
  for (const node of workflow.nodes ?? []) map.set(node.name, node);
  return map;
}

/** Le câblage, réduit à ce qui se compare : qui alimente qui. */
function wiringOf(workflow: N8nWorkflow): string {
  return JSON.stringify(workflow.connections ?? {});
}

/**
 * Plafond de changements retenus. Une correction qui en produit trente n'est pas
 * une correction : l'humain a refait le nœud, et distiller trente leçons d'un
 * même geste remplirait le corpus de bruit corrélé.
 */
export const MAX_CORRECTION_CHANGES = 12;

/**
 * Lit une correction humaine et dit, pour chaque changement, s'il s'apprend, se
 * demande, ou ne dit rien.
 */
export function readCorrection(input: CorrectionInput): CorrectionReading {
  const wrote = nodesByName(input.wrote);
  const fixed = nodesByName(input.fixed);
  const inScope = new Set(input.touchedNodes);
  const changes: CorrectionChange[] = [];

  for (const [name, fixedNode] of fixed) {
    if (isStickyNote(fixedNode)) continue;
    const wroteNode = wrote.get(name);

    // Nœud ajouté par l'humain. Le périmètre ne s'applique pas : un nœud que
    // l'assistant n'a pas écrit est justement ce qu'il a oublié d'écrire.
    if (!wroteNode) {
      changes.push({
        node: name,
        nodeType: fixedNode.type,
        kind: 'wiring',
        verdict: 'ask',
        path: '',
        wrote: '(absent)',
        fixed: fixedNode.type,
        reason:
          `Nœud "${name}" (${fixedNode.type}) ajouté à la main après la proposition : ` +
          "manquait-il à ce que l'assistant a proposé, ou est-ce autre chose ?",
      });
      continue;
    }

    if (!inScope.has(name)) continue;

    for (const leaf of compareValues(wroteNode.parameters ?? {}, fixedNode.parameters ?? {}, '')) {
      const base = { node: name, nodeType: fixedNode.type, path: leaf.path };
      if (leaf.kind === 'structural') {
        changes.push({
          ...base,
          kind: 'structural',
          verdict: 'lesson',
          wrote: excerpt(leaf.wrote),
          fixed: excerpt(leaf.fixed),
          reason:
            `La FORME de ${leaf.path || 'parameters'} a été corrigée : ce que le schéma du ` +
            "nœud déclare, l'assistant ne l'avait pas respecté.",
        });
        continue;
      }
      const { verdict, reason } = verdictForValue(leaf.wrote, leaf.path || 'parameters');
      changes.push({
        ...base,
        kind: 'value',
        verdict,
        wrote: excerpt(leaf.wrote),
        fixed: excerpt(leaf.fixed),
        reason,
      });
    }

    // Réglages du nœud : un HTTP laissé sans retry puis corrigé à la main dit
    // quelque chose que `parameters` ne dit pas.
    for (const field of SETTING_FIELDS) {
      if (IGNORED_NODE_FIELDS.has(field)) continue;
      if (JSON.stringify(wroteNode[field]) === JSON.stringify(fixedNode[field])) continue;
      changes.push({
        node: name,
        nodeType: fixedNode.type,
        kind: 'structural',
        verdict: 'lesson',
        path: field,
        wrote: excerpt(wroteNode[field]),
        fixed: excerpt(fixedNode[field]),
        reason: `Réglage "${field}" corrigé à la main sur "${name}".`,
      });
    }
  }

  // Nœud supprimé par l'humain : l'assistant en avait posé un de trop.
  for (const [name, wroteNode] of wrote) {
    if (fixed.has(name) || isStickyNote(wroteNode)) continue;
    changes.push({
      node: name,
      nodeType: wroteNode.type,
      kind: 'wiring',
      verdict: 'ask',
      path: '',
      wrote: wroteNode.type,
      fixed: '(supprimé)',
      reason:
        `Nœud "${name}" (${wroteNode.type}) supprimé après la proposition : ` +
        'était-il de trop, ou le besoin a-t-il changé ?',
    });
  }

  if (input.touchedConnections && wiringOf(input.wrote) !== wiringOf(input.fixed)) {
    changes.push({
      node: '',
      nodeType: '',
      kind: 'wiring',
      verdict: 'ask',
      path: 'connections',
      wrote: '(câblage proposé)',
      fixed: '(câblage corrigé)',
      reason:
        'Le câblage a été refait à la main sur des nœuds que la proposition touchait : ' +
        "montage mal compris, ou changement d'avis ?",
    });
  }

  const kept = changes.slice(0, MAX_CORRECTION_CHANGES);
  return {
    changes: kept,
    lessons: kept.filter((change) => change.verdict === 'lesson'),
    questions: kept.filter((change) => change.verdict === 'ask'),
    empty: kept.every((change) => change.verdict === 'ignore'),
  };
}

/**
 * La question à poser à l'humain au tour suivant, ou `null` s'il n'y en a pas.
 *
 * Une seule question, même quand plusieurs changements en appellent : on demande
 * pour apprendre, pas pour faire remplir un formulaire. Les autres attendront la
 * correction suivante — ou ne seront jamais posées, ce qui est le bon prix.
 */
export function correctionQuestion(reading: CorrectionReading): string | null {
  const first = reading.questions[0];
  if (!first) return null;
  const others = reading.questions.length - 1;
  const tail =
    others > 0 ? ` (${others} autre${others > 1 ? 's' : ''} point${others > 1 ? 's' : ''} non repris)` : '';
  return `${first.reason}${tail}`;
}
