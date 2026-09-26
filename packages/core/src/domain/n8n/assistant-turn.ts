/**
 * Lecture de la réponse d'un tour d'assistant.
 *
 * Le modèle répond par une enveloppe JSON (explication + proposition d'édition).
 * Elle arrive parfois illisible, de deux façons : COMPLÈTE mais refusée par
 * `JSON.parse` — l'explication en markdown porte de vrais retours à la ligne —,
 * ce qui se répare et ne coûte alors rien ; ou TRONQUÉE, une grosse modification
 * dépassant le budget de jetons, et il n'y a plus qu'à sauver l'explication,
 * écrite en premier donc arrivée complète. Dans les deux cas l'enveloppe ne doit
 * JAMAIS s'afficher telle quelle.
 */

import { WorkflowEditOperation } from './workflow-edit';
import { msg } from '../../i18n';

/**
 * Un autre workflow du périmètre touché par la même proposition : un
 * sous-workflow appelé par celui de la conversation.
 *
 * Le champ est là parce qu'une modification ne s'arrête pas toujours au
 * workflow ouvert — poser un appel de sous-workflow, c'est écrire des deux
 * côtés — et qu'une proposition livrée par moitiés laisserait le parc dans un
 * état que personne n'a validé : l'appel posé, l'appelé encore vide.
 */
export interface AssistantProposalTarget {
  /** Nom (ou id) du workflow visé, tel que le périmètre le nomme. */
  workflow: string;
  operations: WorkflowEditOperation[];
}

/** Ce que l'assistant est censé renvoyer à chaque tour. */
export interface AssistantTurn {
  reply: string;
  proposal: {
    summary: string;
    /** Opérations sur le workflow de la conversation. Vide si seuls des sous-workflows changent. */
    operations: WorkflowEditOperation[];
    /** Les autres workflows du périmètre touchés par la même proposition. */
    targets: AssistantProposalTarget[];
  } | null;
  /**
   * Le modèle a visiblement rédigé une proposition, illisible au parse (JSON
   * tronqué, objet géant). Sans ce drapeau la modification disparaît en silence :
   * l'explication s'affiche, le diff n'arrive jamais et rien ne le dit.
   */
  malformed?: boolean;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/**
 * Extrait l'objet JSON du tour depuis `start` (hors chaînes). Le point de départ
 * doit être choisi : le premier `{` du texte est souvent une expression n8n
 * (`{{ $json.x }}`) citée dans la prose, pas le JSON attendu.
 */
function extractJsonObject(text: string, start: number): string | null {
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Réécrit les sauts de ligne bruts laissés DANS les chaînes du JSON.
 *
 * C'est la cause la plus fréquente d'une enveloppe illisible, et elle n'a rien
 * d'une troncature : le modèle rédige son explication en markdown — paragraphes,
 * listes — et pose de vrais retours à la ligne dans la valeur de `reply`, que
 * `JSON.parse` refuse (« Bad control character in string literal »). L'enveloppe
 * est COMPLÈTE, la proposition est là, et tout partait à la poubelle pour une
 * touche Entrée. Même chose pour le `jsCode` d'un nœud Code écrit en clair.
 *
 * On ne touche qu'à l'intérieur des chaînes : hors chaîne, ces caractères sont
 * de l'indentation, que `JSON.parse` accepte déjà.
 *
 * Même traitement pour les échappements que JSON n'admet pas : un nœud Code
 * recopié garde ses `\'` (apostrophe française dans une chaîne JS entre
 * apostrophes) ou ses `` \` ``, et UNE seule de ces séquences rendait la
 * proposition entière illisible — à chaque relance, puisque le modèle recopie
 * le même code. La barre est doublée, donc conservée : c'est ce que le code
 * attend pour rester du JavaScript valide.
 */
function escapeRawControls(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (inString && !isValidJsonEscape(chars, i + 1)) {
        out += '\\\\';
        continue;
      }
      out += char;
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString && char < ' ') {
      out += char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : '';
      continue;
    }
    out += char;
  }
  return out;
}

function isValidJsonEscape(chars: string[], at: number): boolean {
  const next = chars[at];
  if (next === undefined) return false;
  if ('"\\/bfnrt'.includes(next)) return true;
  return next === 'u' && /^[0-9a-fA-F]{4}$/.test(chars.slice(at + 1, at + 5).join(''));
}

/**
 * Le texte porte les marques d'une proposition d'édition qu'on n'a pas su lire.
 * Cherché sur le texte BRUT : le JSON est illisible, seuls ses mots-clés restent.
 */
function looksLikeProposal(text: string): boolean {
  return /"operations"\s*:/.test(text) || /"op"\s*:\s*"/.test(text);
}

/**
 * Les workflows ANNEXES d'une proposition, nettoyés de ce qui n'en est pas un.
 * Une entrée sans nom de workflow est jetée plutôt que rattachée à la racine :
 * appliquer des opérations au mauvais workflow est le seul dégât irréparable
 * que ce champ puisse produire.
 */
function readTargets(value: unknown): AssistantProposalTarget[] {
  if (!Array.isArray(value)) return [];
  const targets: AssistantProposalTarget[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const target = entry as { workflow?: unknown; operations?: unknown };
    const workflow = typeof target.workflow === 'string' ? target.workflow.trim() : '';
    const operations = Array.isArray(target.operations) ? (target.operations as WorkflowEditOperation[]) : [];
    if (!workflow || operations.length === 0) continue;
    targets.push({ workflow, operations });
  }
  return targets;
}

/** Le texte EST l'enveloppe du tour, lisible ou non — donc jamais à afficher tel quel. */
function looksLikeEnvelope(text: string): boolean {
  return /\{\s*"reply"\s*:/.test(text) || looksLikeProposal(text);
}

/**
 * Récupère la valeur de `"reply"` dans une enveloppe qu'on n'a pas su parser.
 *
 * Le cas qui compte est le JSON TRONQUÉ d'une grosse modification : `reply` est
 * écrit en premier et arrive donc complet, c'est tout le reste qui manque. Sans
 * ça on affichait l'enveloppe brute, coupée en plein milieu — deux messages
 * illisibles, et l'explication perdue alors qu'elle était là.
 *
 * Lecture caractère par caractère plutôt qu'une regex : la valeur contient des
 * guillemets échappés (c'est du JSON dans du JSON), qu'une regex refermerait trop tôt.
 */
function salvageReply(text: string): string | null {
  const key = /"reply"\s*:\s*"/.exec(text);
  if (!key) return null;
  let value = '';
  let escaped = false;
  for (let i = key.index + key[0].length; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      // Séquences d'échappement JSON, rendues telles que le modèle les a écrites.
      value += char === 'n' ? '\n' : char === 't' ? '\t' : char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') return value.trim() || null;
    value += char;
  }
  // Chaîne jamais refermée : le texte a été coupé DANS la réponse. Ce qu'on a lu
  // reste la meilleure explication disponible, et vaut mieux que l'enveloppe brute.
  return value.trim() || null;
}

/**
 * Lit la réponse du modèle. Tolérant : si le JSON est absent ou illisible, tout le
 * texte devient la réponse affichée (mieux qu'une erreur, la conversation continue).
 */
export function parseAssistantTurn(text: string): AssistantTurn {
  const candidate = stripFences(text);
  // Points de départ plausibles du JSON : un `{` immédiatement suivi de "reply",
  // où qu'il soit — le modèle glisse parfois de la prose avant l'objet.
  const starts = [...candidate.matchAll(/\{\s*"reply"/g)].map((m) => m.index ?? -1);
  const extracted = starts
    .map((start) => extractJsonObject(candidate, start))
    .filter((s): s is string => Boolean(s));
  // Chaque candidat est retenté une fois ses sauts de ligne bruts échappés : une
  // enveloppe entière ne doit pas se perdre sur la mise en forme de l'explication.
  const sources = [candidate, ...extracted].flatMap((source) =>
    source ? [source, escapeRawControls(source)] : [],
  );
  for (const source of sources) {
    if (!source) continue;
    try {
      const parsed = JSON.parse(source) as Partial<AssistantTurn>;
      if (typeof parsed?.reply !== 'string') continue;
      const proposal = parsed.proposal;
      const operations = Array.isArray(proposal?.operations) ? proposal.operations : [];
      const targets = readTargets(proposal?.targets);
      return {
        reply: parsed.reply,
        proposal:
          proposal && (operations.length > 0 || targets.length > 0)
            ? {
                summary: proposal.summary?.trim() || msg('chat.proposalDefaultSummary'),
                operations,
                targets,
              }
            : null,
      };
    } catch {
      // format inattendu : on retombe sur le texte brut
    }
  }
  // Enveloppe illisible : on ne rend JAMAIS le JSON brut à l'écran. On sauve
  // l'explication si elle est là, sinon on écrit un constat — un pavé de JSON
  // tronqué n'apprend rien à celui qui lit et fait passer le bug pour une réponse.
  if (looksLikeEnvelope(candidate)) {
    return {
      reply: salvageReply(candidate) ?? msg('chat.replyUnreadable'),
      proposal: null,
      malformed: true,
    };
  }
  // Prose ordinaire (pas d'enveloppe) : le modèle a répondu sans le format attendu,
  // son texte est la réponse et il n'y a rien à signaler.
  return { reply: candidate || text, proposal: null, malformed: false };
}
