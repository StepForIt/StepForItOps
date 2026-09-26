import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { MESSAGES } from './messages';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

interface AstNode {
  type: number;
  value?: string;
  options?: Record<string, { value: AstNode[] }>;
  children?: AstNode[];
}

/** Arguments d'un message, lus sur son arbre ICU : le texte d'une branche plural/select n'en est pas un. */
function variables(message: string, locale: string): string {
  const names = new Set<string>();
  const walk = (nodes: AstNode[]) => {
    for (const node of nodes) {
      // 0 = texte littéral, 7 = « # » d'un pluriel ; le reste porte un nom d'argument ou de balise.
      if (node.type !== 0 && node.type !== 7 && node.value) names.add(node.value);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
      if (node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst() as unknown as AstNode[]);
  return [...names].sort().join();
}

const fr = flatten(MESSAGES.fr as unknown as Tree);
const en = flatten(MESSAGES.en as unknown as Tree);

describe('messages', () => {
  it('les deux langues ont exactement les mêmes clés', () => {
    expect([...en.keys()].filter((k) => !fr.has(k))).toEqual([]);
    expect([...fr.keys()].filter((k) => !en.has(k))).toEqual([]);
  });

  it('aucune clé ne contient de point (next-intl y lit une imbrication)', () => {
    const bad = (tree: Tree): string[] =>
      Object.entries(tree).flatMap(([k, v]) => [
        ...(k.includes('.') ? [k] : []),
        ...(typeof v === 'string' ? [] : bad(v)),
      ]);
    expect(bad(MESSAGES.fr as unknown as Tree)).toEqual([]);
  });

  for (const [locale, messages] of [
    ['fr', fr],
    ['en', en],
  ] as const) {
    it(`${locale} : chaque message est un ICU valide`, () => {
      const broken: string[] = [];
      for (const [key, message] of messages) {
        try {
          new IntlMessageFormat(message, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      expect(broken).toEqual([]);
    });

    // En ICU, une apostrophe collée à une accolade ouvre une citation : « d'{name} » rendrait
    // « d{name} » tel quel. Il faut la doubler : « d''{name} ».
    it(`${locale} : pas d'apostrophe simple devant une accolade`, () => {
      const bad = [...messages].filter(([, m]) => /(^|[^'])'[{}]/.test(m)).map(([k]) => k);
      expect(bad).toEqual([]);
    });

    it(`${locale} : mêmes variables que le français`, () => {
      const diff = [...messages]
        .filter(([k, m]) => {
          try {
            return fr.has(k) && variables(m, locale) !== variables(fr.get(k)!, 'fr');
          } catch {
            return false; // message invalide : signalé par le test ICU
          }
        })
        .map(([k]) => k);
      expect(diff).toEqual([]);
    });
  }
});
