/**
 * Copie navigateur de `packages/core/src/domain/chat-completion.ts` (le web ne
 * dépend pas de `@nwm/core`). La règle et ses tests vivent là-bas ; ici, elle
 * doit tourner à chaque frappe, sans aller-retour réseau.
 */

/** Ce dans quoi la complétion cherche. Rempli par l'API, jamais deviné ici. */
export interface CompletionSources {
  /** Demandes entières : proposées quand la ligne en cours en est le début. */
  phrases: string[];
  /** Noms de nœuds du workflow : complétés sur le dernier mot de la ligne. */
  nodeNames: string[];
}

/**
 * En dessous, tout ressemble au début de tout : la ligne complèterait au premier
 * caractère et la suggestion sauterait d'une phrase à l'autre à chaque frappe.
 */
export const MIN_COMPLETION_CHARS = 3;

/**
 * Comparaison insensible à la casse et aux accents, **caractère pour caractère** :
 * la longueur est conservée, sinon l'indice de découpe de la suggestion ne
 * correspondrait plus à ce que l'utilisateur a tapé (« crée » fait 4 caractères,
 * sa forme comparable aussi).
 */
function comparable(text: string): string {
  return Array.from(text)
    .map((char) => char.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || char)
    .join('')
    .toLowerCase();
}

/**
 * La plus courte des suites possibles. Le plus court est le moins présomptueux :
 * une suggestion longue qu'on accepte par réflexe écrit une demande que personne
 * n'a formulée.
 */
function shortestCompletion(typed: string, candidates: string[]): string | null {
  const needle = comparable(typed);
  const found = candidates
    .filter((candidate) => candidate.length > typed.length && comparable(candidate).startsWith(needle))
    .map((candidate) => candidate.slice(typed.length))
    // Tri stable et reproductible : à longueur égale, l'ordre alphabétique
    // plutôt que celui — arbitraire — dans lequel les sources sont arrivées.
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return found[0] ?? null;
}

/**
 * Ce qu'il reste à écrire après `draft`, ou `null` quand rien ne s'impose.
 *
 * Le raisonnement porte sur la LIGNE en cours : dans un message de plusieurs
 * lignes, celles d'avant sont écrites et ne se complètent plus.
 */
export function completeDraft(draft: string, sources: CompletionSources): string | null {
  // Un espace en fin de frappe est une hésitation, pas un début de mot : compléter
  // là ferait apparaître une suggestion sans que rien n'ait été tapé.
  if (!draft || /\s$/.test(draft)) return null;
  const line = draft.slice(draft.lastIndexOf('\n') + 1);
  if (line.trim().length < MIN_COMPLETION_CHARS) return null;

  const phrase = shortestCompletion(line, sources.phrases);
  if (phrase) return phrase;

  // À défaut de phrase, le nom du nœud qu'on est en train d'écrire. Un nom de
  // nœud arrive au milieu d'une demande (« ajoute un retry sur HTTP Fact… ») et
  // porte souvent des espaces : on essaie donc les fins de ligne successives, du
  // mot le plus ancien au plus récent, pour retenir la plus longue qui accroche.
  for (const start of wordStarts(line)) {
    const tail = line.slice(start);
    if (tail.length < MIN_COMPLETION_CHARS) break;
    const node = shortestCompletion(tail, sources.nodeNames);
    if (node) return node;
  }
  return null;
}

/** Indices de début de mot de la ligne, du premier au dernier. */
function wordStarts(line: string): number[] {
  const starts: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (index === 0 ? /\S/.test(line[index]!) : /\s/.test(line[index - 1]!) && /\S/.test(line[index]!)) {
      starts.push(index);
    }
  }
  return starts;
}
