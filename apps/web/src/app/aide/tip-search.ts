import { matchesQuery, normalize } from '../../lib/command-search';
import { Tip, TipGroupId } from './tip-catalog';

type TipGroups = Array<{ id: TipGroupId; label: string }>;

export function matchesTip(tip: Tip, query: string, groups: TipGroups): boolean {
  const group = groups.find((g) => g.id === tip.group)?.label;
  return matchesQuery(query, tip.title, tip.text, tip.where, group, tip.keywords);
}

/** Morceaux à surligner ; texte rendu tel quel si la forme sans accents n'a pas la même longueur. */
export function highlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const folded = normalize(text);
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length || folded.length !== text.length) return [{ text, hit: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let i = folded.indexOf(word); i >= 0; i = folded.indexOf(word, i + word.length)) {
      marks.fill(true, i, i + word.length);
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

export function groupTips(
  tips: Tip[],
  groups: TipGroups,
): Array<{ id: TipGroupId; label: string; tips: Tip[] }> {
  return groups
    .map((group) => ({ ...group, tips: tips.filter((tip) => tip.group === group.id) }))
    .filter((group) => group.tips.length);
}
