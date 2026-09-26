/**
 * Lecture d'une documentation Markdown par morceaux.
 *
 * Un README de nœud communautaire pèse souvent 20 à 60 Ko, dont l'essentiel
 * (installation, changelog, licence) ne sert à rien pour configurer un nœud.
 * Le servir entier coûtait un contexte à chaque appel ; le couper au hasard
 * perdait justement la section utile. On sert donc un SOMMAIRE, puis la
 * section que le modèle choisit.
 */

export interface MarkdownSection {
  title: string;
  /** 1 à 6 ; 1 pour le préambule sans titre. */
  level: number;
  /** La section ET ses sous-sections, titre compris. */
  content: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const heads: Array<{ line: number; level: number; title: string }> = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) return;
    const match = HEADING.exec(line);
    if (match) heads.push({ line: index, level: match[1].length, title: match[2].trim() });
  });

  const sections: MarkdownSection[] = [];
  const firstHead = heads[0]?.line ?? lines.length;
  const preamble = lines.slice(0, firstHead).join('\n').trim();
  if (preamble) sections.push({ title: 'Introduction', level: 1, content: preamble });

  heads.forEach((head, index) => {
    const end = heads.slice(index + 1).find((next) => next.level <= head.level)?.line ?? lines.length;
    sections.push({
      title: head.title,
      level: head.level,
      content: lines.slice(head.line, end).join('\n').trim(),
    });
  });
  return sections;
}

/**
 * Descend chaque titre d'un niveau, pour ranger un document sous un titre qui
 * le nomme (« README npm 1.2.0 ») sans que ses sections passent pour des sœurs.
 */
export function demoteHeadings(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      if (inFence || !HEADING.test(line) || line.startsWith('######')) return line;
      return `#${line}`;
    })
    .join('\n');
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Titre exact d'abord, sinon les titres qui contiennent la recherche. */
export function findSections(sections: MarkdownSection[], query: string): MarkdownSection[] {
  const wanted = normalize(query);
  if (!wanted) return [];
  const exact = sections.filter((section) => normalize(section.title) === wanted);
  if (exact.length > 0) return exact;
  return sections.filter((section) => normalize(section.title).includes(wanted));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[cut: ${text.length - max} more characters]`;
}

function renderIndex(sections: MarkdownSection[]): string {
  return sections
    .map(
      (section) =>
        `${'  '.repeat(Math.max(0, section.level - 1))}- ${section.title} (${section.content.length} chars)`,
    )
    .join('\n');
}

/**
 * Ce qu'on rend au modèle : la section demandée, ou à défaut le sommaire suivi
 * du début du document — assez pour qu'il sache quoi demander ensuite.
 */
export function readDocSection(markdown: string, section: string | undefined, max: number): string {
  const sections = splitMarkdownSections(markdown);
  if (section) {
    const found = findSections(sections, section);
    if (found.length > 0) return clip(found.map((entry) => entry.content).join('\n\n'), max);
    return `No section "${section}". Contents:\n${renderIndex(sections)}`;
  }
  return `Contents:\n${renderIndex(sections)}\n\nStart of the document:\n${clip(markdown.trim(), Math.min(max, 2000))}`;
}
