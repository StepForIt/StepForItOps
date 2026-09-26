import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { MESSAGES, msgIn } from '../src';

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

const entries = Object.entries(MESSAGES).flatMap(([ns, catalog]) =>
  Object.keys(catalog.en).map((key) => ({
    id: `${ns}.${key}`,
    en: (catalog.en as Record<string, string>)[key],
    fr: (catalog.fr as Record<string, string>)[key],
  })),
);

describe('catalogues de messages', () => {
  it('le français a exactement les clés de l’anglais', () => {
    const extra = Object.entries(MESSAGES).flatMap(([ns, catalog]) =>
      Object.keys(catalog.fr)
        .filter((key) => !(key in catalog.en))
        .map((key) => `${ns}.${key}`),
    );
    expect(extra).toEqual([]);
    expect(entries.filter((e) => typeof e.fr !== 'string').map((e) => e.id)).toEqual([]);
  });

  for (const locale of ['en', 'fr'] as const) {
    it(`${locale} : chaque message est un ICU valide`, () => {
      const broken: string[] = [];
      for (const entry of entries) {
        try {
          new IntlMessageFormat(entry[locale], locale);
        } catch (error) {
          broken.push(`${entry.id}: ${(error as Error).message}`);
        }
      }
      expect(broken).toEqual([]);
    });

    // En ICU, une apostrophe collée à une accolade ouvre une citation : « d'{name} » rendrait
    // « d{name} » tel quel. Il faut la doubler : « d''{name} ».
    it(`${locale} : pas d'apostrophe simple devant une accolade`, () => {
      expect(entries.filter((e) => /(^|[^'])'[{}]/.test(e[locale])).map((e) => e.id)).toEqual([]);
    });
  }

  it('mêmes variables dans les deux langues', () => {
    const diff = entries.filter((e) => {
      try {
        return variables(e.en, 'en') !== variables(e.fr, 'fr');
      } catch {
        return false; // message invalide : signalé par le test ICU
      }
    });
    expect(diff.map((e) => e.id)).toEqual([]);
  });

  it('le code source anglais ne porte pas de français accentué', () => {
    const accented = entries.filter((e) => /[àâçéèêëîïôûùüÿœæ]/i.test(e.en)).map((e) => e.id);
    expect(accented).toEqual([]);
  });

  it('rend un message dans la langue demandée', () => {
    expect(msgIn('en', 'common.internalError')).toBe('Internal server error');
    expect(msgIn('fr', 'common.internalError')).toBe('Erreur interne du serveur');
  });
});
