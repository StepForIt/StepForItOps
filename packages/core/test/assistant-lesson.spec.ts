import { describe, expect, it } from 'vitest';
import {
  AssistantLesson,
  MAX_BRIEF_CHARS,
  MAX_LESSON_LENGTH,
  MAX_RECALLED,
  keywordsOf,
  recallLessons,
  renderLessonBrief,
  saysTheSame,
  scoreLesson,
  statusAfterOccurrence,
  trimLesson,
} from '../src/domain/assistant-lesson';

const HTTP = 'n8n-nodes-base.httpRequest';

function lesson(over: Partial<AssistantLesson> = {}): AssistantLesson {
  return {
    id: 'l1',
    content: "Sur un HTTP Request, lire $('Nom').item.json et non $json en aval.",
    nodeTypes: [HTTP],
    keywords: keywordsOf('HTTP Request écrase le json de item lire en aval'),
    status: 'active',
    occurrences: 2,
    recalls: 0,
    origin: 'human-correction',
    ...over,
  };
}

describe('mots-clés', () => {
  it('retire les accents, la casse et les mots vides', () => {
    expect(keywordsOf('Le paramètre EST défini')).toEqual(['parametre', 'defini']);
  });

  it('dédoublonne', () => {
    expect(keywordsOf('retry retry retry')).toEqual(['retry']);
  });
});

describe('rappel', () => {
  it('le type de nœud présent l’emporte sur le lexical', () => {
    const typed = lesson({ id: 'typed' });
    const general = lesson({ id: 'general', nodeTypes: [], keywords: keywordsOf('http request json aval') });
    const got = recallLessons([general, typed], { nodeTypes: [HTTP], question: 'http request json aval' });
    expect(got[0].id).toBe('typed');
  });

  it('écarte une leçon dont le type de nœud n’est pas dans le workflow', () => {
    const got = recallLessons([lesson()], { nodeTypes: ['n8n-nodes-base.set'], question: 'http' });
    expect(got).toEqual([]);
  });

  it('ne sert jamais une candidate : un cas particulier n’est pas une règle', () => {
    const got = recallLessons([lesson({ status: 'candidate' })], { nodeTypes: [HTTP], question: 'http' });
    expect(got).toEqual([]);
  });

  it('ne sert pas une retirée', () => {
    const got = recallLessons([lesson({ status: 'retired' })], { nodeTypes: [HTTP], question: 'http' });
    expect(got).toEqual([]);
  });

  it('borne le nombre servi', () => {
    const many = Array.from({ length: 20 }, (_, index) => lesson({ id: `l${index}` }));
    expect(recallLessons(many, { nodeTypes: [HTTP], question: 'http' })).toHaveLength(MAX_RECALLED);
  });

  it('une leçon générale ne remonte que par les mots de la question', () => {
    const general = lesson({ nodeTypes: [], keywords: keywordsOf('gabarit valeur exemple jamais inventer') });
    expect(scoreLesson(general, { nodeTypes: [HTTP], question: 'pourquoi ce gabarit' })).toBeGreaterThan(0);
    expect(scoreLesson(general, { nodeTypes: [HTTP], question: 'ajoute un noeud' })).toBe(0);
  });
});

describe('rendu', () => {
  it('rend null sans leçon plutôt qu’une rubrique vide', () => {
    expect(renderLessonBrief([])).toBeNull();
  });

  it('respecte le plafond de caractères', () => {
    const long = Array.from({ length: 10 }, (_, index) =>
      lesson({ id: `l${index}`, content: 'x'.repeat(MAX_LESSON_LENGTH) }),
    );
    expect(renderLessonBrief(long)!.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
  });
});

describe('mise à jour de soi', () => {
  it('reconnaît deux formulations de la même règle', () => {
    const existing = lesson();
    expect(
      saysTheSame(existing, {
        keywords: keywordsOf('HTTP Request écrase le json de item en aval'),
        nodeTypes: [HTTP],
      }),
    ).toBe(true);
  });

  it('ne fusionne pas deux règles seulement voisines', () => {
    expect(
      saysTheSame(lesson(), {
        keywords: keywordsOf('poser un timeout sur les appels sortants'),
        nodeTypes: [HTTP],
      }),
    ).toBe(false);
  });

  it('ne fusionne jamais à travers deux types de nœuds', () => {
    expect(saysTheSame(lesson(), { keywords: lesson().keywords, nodeTypes: ['n8n-nodes-base.set'] })).toBe(
      false,
    );
  });
});

describe('promotion', () => {
  it('une première occurrence reste candidate', () => {
    expect(statusAfterOccurrence('candidate', 1, false)).toBe('candidate');
  });

  it('la deuxième occurrence indépendante active', () => {
    expect(statusAfterOccurrence('candidate', 2, false)).toBe('active');
  });

  it('une réponse humaine active tout de suite', () => {
    expect(statusAfterOccurrence('candidate', 1, true)).toBe('active');
  });

  it('une leçon retirée ne revient pas toute seule', () => {
    expect(statusAfterOccurrence('retired', 5, true)).toBe('retired');
  });
});

describe('troncature', () => {
  it('laisse une leçon courte intacte', () => {
    expect(trimLesson('  Ne pose jamais   de gabarit. ')).toBe('Ne pose jamais de gabarit.');
  });

  it('tronque plutôt que de refuser', () => {
    expect(trimLesson('x'.repeat(500))).toHaveLength(MAX_LESSON_LENGTH);
  });
});
