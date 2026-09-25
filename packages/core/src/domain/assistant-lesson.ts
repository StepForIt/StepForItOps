/**
 * Les leçons que l'assistant se constitue, et surtout ce qui les empêche de
 * devenir un second prompt.
 *
 * Le point de départ est un constat sur le code existant : `chat-prompt.ts` porte
 * déjà un bloc « PIÈGES n8n — vus en exploitation » et une section « VÉRIFICATION —
 * c'est ici qu'on a le plus perdu ». Ce sont exactement des leçons, mais écrites à
 * la main, dans un prompt statique, payées à chaque tour et à croissance
 * monotone : rien n'en sort jamais, et personne ne saura dire dans six mois
 * laquelle sert encore.
 *
 * D'où le choix de forme : une leçon est une LIGNE, pas un fichier. Le corpus
 * grossit en nombre de lignes, ce qui ne coûte rien ; ce qui coûte, c'est le
 * nombre de lignes SERVIES, et lui est borné dur (`MAX_RECALLED`, `MAX_BRIEF_CHARS`).
 * Une leçon nouvelle qui redit une existante la RÉÉCRIT au lieu de s'y ajouter —
 * c'est là qu'est la mise à jour de soi, et c'est ce qui distingue un corpus qui
 * s'affine d'un journal qui s'allonge.
 *
 * Le rappel est d'abord DÉTERMINISTE : le contexte du tour connaît déjà les types
 * de nœuds du workflow, donc une leçon indexée sur `n8n-nodes-base.httpRequest`
 * remonte parce que le nœud est là — exact, gratuit, sans embedding. Le lexical ne
 * fait que le reste. Une recherche vectorielle se brancherait ici sans rien
 * changer d'autre, mais à quelques centaines de leçons elle n'apporterait rien que
 * ces deux voies ne donnent déjà.
 */

/**
 * `candidate` — née d'un seul incident, PAS servie au modèle. Un cas particulier
 * n'est pas une règle, et l'injecter reviendrait à généraliser sur un exemple.
 * `active` — confirmée : deuxième occurrence indépendante, ou validation humaine.
 * `retired` — fausse, périmée, ou jamais rappelée. Gardée, jamais servie : savoir
 * ce qu'on a cru vrai vaut mieux que de le perdre.
 */
export type LessonStatus = 'candidate' | 'active' | 'retired';

/**
 * D'où vient la leçon, et donc ce qu'elle vaut.
 * `human-answer` est la plus fiable — quelqu'un a répondu à la question.
 * `human-correction` vient d'un diff structurel arbitré par le schéma.
 * `gate-refusal` vient d'un refus déterministe corrigé dans le tour.
 */
export type LessonOrigin = 'human-answer' | 'human-correction' | 'gate-refusal';

export interface AssistantLesson {
  id: string;
  content: string;
  nodeTypes: string[];
  keywords: string[];
  status: LessonStatus;
  occurrences: number;
  recalls: number;
  origin: LessonOrigin;
}

/**
 * Longueur d'une leçon. Même borne que `chat-memory` à 100 caractères près, et
 * pour la même raison : assez pour une règle écrite en une phrase, trop court pour
 * qu'on y recopie un bout de workflow. Une leçon qui ne tient pas ici est une
 * leçon mal dégagée de son cas particulier.
 */
export const MAX_LESSON_LENGTH = 300;

/**
 * Leçons servies au modèle par tour. Six tient dans une rubrique qui se lit ; au
 * delà on ne rappelle plus, on remplit — et les deux qui comptaient se noient dans
 * les quatre qui ne servaient pas.
 */
export const MAX_RECALLED = 6;

/** Plafond dur du bloc injecté, quelle que soit la longueur des leçons retenues. */
export const MAX_BRIEF_CHARS = 1200;

/**
 * Occurrences indépendantes qui promeuvent une candidate. Deux suffit : la même
 * erreur commise deux fois dans deux workflows différents n'est plus un accident.
 */
export const OCCURRENCES_TO_PROMOTE = 2;

/**
 * Rappels sans lesquels une leçon finit par se retirer. Une règle qu'aucun tour
 * n'a jamais eu besoin de voir n'a pas de raison d'être payée éternellement.
 */
export const MIN_RECALLS_BEFORE_RETIRE = 0;

/** Mots vides français et anglais : les garder ferait apparier sur « le » et « the ». */
const STOP_WORDS = new Set([
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'du',
  'de',
  'et',
  'ou',
  'que',
  'qui',
  'quoi',
  'dans',
  'pour',
  'par',
  'sur',
  'avec',
  'sans',
  'est',
  'sont',
  'pas',
  'ne',
  'au',
  'aux',
  'ce',
  'cet',
  'cette',
  'ces',
  'son',
  'sa',
  'ses',
  'il',
  'elle',
  'on',
  'en',
  'y',
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'is',
  'are',
  'and',
  'or',
  'for',
  'with',
  'not',
]);

/**
 * Les mots signifiants d'un texte, pour l'appariement lexical.
 *
 * Volontairement naïf : la casse et les accents tombent, les mots de moins de
 * trois lettres aussi. Un appariement plus fin demanderait un index, et l'index
 * n'apporte rien tant que le déterminisme fait le gros du travail.
 */
export function keywordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

export interface LessonQuery {
  /** Types de nœuds présents dans le workflow du tour : la voie déterministe. */
  nodeTypes: string[];
  /** La question posée par l'humain, d'où l'on tire les mots-clés. */
  question: string;
}

/**
 * Score d'une leçon pour ce tour. Trois termes, dans cet ordre d'importance :
 *
 *  - le type de nœud, qui vaut à lui seul plus que tout le lexical réuni. Une
 *    leçon sur `httpRequest` dans un workflow qui en contient est pertinente,
 *    que la question en parle ou non ;
 *  - le recouvrement de mots avec la question ;
 *  - les occurrences, qui départagent à égalité — une leçon vue trois fois passe
 *    devant une leçon vue deux fois.
 *
 * Une leçon SANS type de nœud est générale (« ne pose jamais de gabarit ») : elle
 * ne peut pas gagner par la voie déterministe, et c'est voulu — sinon les leçons
 * générales trusteraient les six places à chaque tour.
 */
export function scoreLesson(lesson: AssistantLesson, query: LessonQuery): number {
  const present = new Set(query.nodeTypes);
  const typeHit = lesson.nodeTypes.some((type) => present.has(type));
  if (lesson.nodeTypes.length > 0 && !typeHit) return 0;

  const asked = new Set(keywordsOf(query.question));
  const overlap = lesson.keywords.filter((word) => asked.has(word)).length;

  // Rien n'accroche : pas de score. Les occurrences DÉPARTAGENT, elles ne
  // qualifient pas — sans ce garde, une leçon générale assez souvent vue
  // remonterait à tous les tours, y compris ceux qui n'en parlent pas.
  if (!typeHit && overlap === 0) return 0;

  return (typeHit ? 100 : 0) + overlap * 10 + Math.min(lesson.occurrences, 5);
}

/**
 * Les leçons à servir ce tour, déjà triées et bornées.
 *
 * Les candidates sont écartées ici et non par le stockage : c'est la lecture qui
 * décide de ce qu'on paie, et une candidate reste consultable à l'écran.
 */
export function recallLessons(lessons: AssistantLesson[], query: LessonQuery): AssistantLesson[] {
  return lessons
    .filter((lesson) => lesson.status === 'active')
    .map((lesson) => ({ lesson, score: scoreLesson(lesson, query) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECALLED)
    .map((scored) => scored.lesson);
}

/**
 * Le bloc à injecter dans le prompt, ou `null` s'il n'y a rien à dire.
 *
 * `null` et non une rubrique vide : une section « leçons apprises » sans leçon
 * invite le modèle à la remplir de généralités, exactement comme la mémoire vide.
 */
export function renderLessonBrief(lessons: AssistantLesson[]): string | null {
  if (lessons.length === 0) return null;
  const lines: string[] = [];
  let budget = MAX_BRIEF_CHARS;
  for (const lesson of lessons) {
    const line = `- ${lesson.content}`;
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Deux leçons disent-elles la même chose ?
 *
 * Sert à réécrire plutôt qu'à empiler. Le seuil est haut (deux tiers des mots
 * signifiants en commun) : fusionner deux règles seulement voisines produirait une
 * leçon molle qui ne vaut plus pour aucun des deux cas.
 */
export function saysTheSame(a: AssistantLesson, b: { keywords: string[]; nodeTypes: string[] }): boolean {
  const sameScope =
    a.nodeTypes.length === 0 && b.nodeTypes.length === 0
      ? true
      : a.nodeTypes.some((type) => b.nodeTypes.includes(type));
  if (!sameScope) return false;

  const others = new Set(b.keywords);
  const shared = a.keywords.filter((word) => others.has(word)).length;
  const smallest = Math.min(a.keywords.length, b.keywords.length);
  return smallest > 0 && shared / smallest >= 0.66;
}

/**
 * Le statut d'une leçon après une occurrence de plus.
 *
 * Une validation humaine (`confirmed`) active tout de suite : quelqu'un a répondu,
 * il n'y a plus rien à confirmer. Sinon il faut la deuxième occurrence.
 */
export function statusAfterOccurrence(
  current: LessonStatus,
  occurrences: number,
  confirmed: boolean,
): LessonStatus {
  if (current === 'retired') return 'retired';
  if (confirmed) return 'active';
  return occurrences >= OCCURRENCES_TO_PROMOTE ? 'active' : 'candidate';
}

/** Une leçon trop longue est tronquée proprement plutôt que refusée : elle vient d'un modèle. */
export function trimLesson(content: string): string {
  const text = content.trim().replace(/\s+/g, ' ');
  return text.length <= MAX_LESSON_LENGTH ? text : `${text.slice(0, MAX_LESSON_LENGTH - 1)}…`;
}
