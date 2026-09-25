/**
 * Localisation d'un finding dans le code d'un nœud. Un message sans la ligne
 * fautive oblige à rouvrir n8n et à relire tout le nœud : c'est la moitié du
 * temps de traitement d'un finding de code.
 */

/** Lignes de contexte de part et d'autre de la ligne fautive. */
const CONTEXT_LINES = 2;

export interface CodeLocation {
  /** 1-indexée, comme l'éditeur n8n. */
  line: number;
  /** Extrait avec son contexte, tel qu'affiché au survol. */
  snippet: string;
  /** Première ligne de l'extrait, pour numéroter l'affichage. */
  snippetStart: number;
}

/** Localise une position (index caractère) dans le code. */
export function locateIndex(code: string, index: number): CodeLocation {
  const lines = code.split('\n');
  const line = code.slice(0, Math.max(0, index)).split('\n').length;
  return sliceAround(lines, line);
}

/**
 * Localise un fragment cité. Le fragment est cherché tel quel, puis à blancs
 * normalisés : une IA recopie rarement l'indentation à l'identique. Introuvable
 * ⇒ null, jamais un numéro inventé.
 */
export function locateQuote(code: string, quote: string): CodeLocation | null {
  const needle = quote.trim();
  if (!needle) return null;

  const direct = code.indexOf(needle);
  if (direct >= 0) return locateIndex(code, direct);

  const firstLine = needle.split('\n')[0]!.trim();
  if (!firstLine) return null;
  const squashed = (text: string) => text.replace(/\s+/g, ' ').trim();
  const target = squashed(firstLine);
  const lines = code.split('\n');
  const found = lines.findIndex((line) => squashed(line).includes(target));
  return found >= 0 ? sliceAround(lines, found + 1) : null;
}

function sliceAround(lines: string[], line: number): CodeLocation {
  const start = Math.max(1, line - CONTEXT_LINES);
  const end = Math.min(lines.length, line + CONTEXT_LINES);
  return {
    line,
    snippet: lines.slice(start - 1, end).join('\n'),
    snippetStart: start,
  };
}
