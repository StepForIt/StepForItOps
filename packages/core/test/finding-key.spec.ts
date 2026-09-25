import { describe, expect, it } from 'vitest';
import { findingIgnoreCovers, findingMessageKey } from '../src/domain/finding-key';

describe('findingMessageKey', () => {
  it('ignore casse, accents et ponctuation', () => {
    expect(findingMessageKey('Le nœud « Set » écrase la donnée.')).toBe(
      findingMessageKey('le noeud set ecrase la donnee'),
    );
  });

  it('neutralise les nombres, qui varient d’une passe à l’autre', () => {
    expect(findingMessageKey('3 items ignorés')).toBe(findingMessageKey('12 items ignorés'));
  });

  it('distingue deux remarques différentes', () => {
    expect(findingMessageKey('accès indexé sans garde')).not.toBe(
      findingMessageKey('gestion d’erreur manquante'),
    );
  });
});

describe('findingIgnoreCovers', () => {
  const rule = {
    code: 'js-ai',
    nodeName: 'Normaliser',
    nodeId: 'node-1',
    messageKey: findingMessageKey('accès indexé sans garde'),
  };
  const nodeIds = new Map([['Normaliser (v2)', 'node-1']]);

  it('ne couvre pas un autre code', () => {
    expect(findingIgnoreCovers(rule, { code: 'js-unsafe', nodeName: 'Normaliser' })).toBe(false);
  });

  it('couvre le nœud visé par son nom', () => {
    expect(findingIgnoreCovers(rule, { code: 'js-ai', nodeName: 'Normaliser' })).toBe(true);
  });

  it('suit le nœud renommé, via son id n8n', () => {
    expect(
      findingIgnoreCovers(
        rule,
        { code: 'js-ai', nodeName: 'Normaliser (v2)', message: 'autre chose' },
        nodeIds,
      ),
    ).toBe(true);
  });

  it('rattrape la même remarque sur un nœud sans id connu', () => {
    expect(
      findingIgnoreCovers(rule, { code: 'js-ai', nodeName: 'Autre', message: 'Accès indexé sans garde !' }),
    ).toBe(true);
  });

  it('laisse passer une remarque différente sur un autre nœud', () => {
    expect(findingIgnoreCovers(rule, { code: 'js-ai', nodeName: 'Autre', message: 'async mal géré' })).toBe(
      false,
    );
  });

  it('règle « n’importe quel nœud » : couvre tout le code', () => {
    const anyNode = { code: 'ai-logic', nodeName: null, nodeId: null, messageKey: null };
    expect(findingIgnoreCovers(anyNode, { code: 'ai-logic', nodeName: 'X' })).toBe(true);
  });

  it('règle héritée (ni id ni empreinte) : appariement par nom seul', () => {
    const legacy = { code: 'js-ai', nodeName: 'Normaliser', nodeId: null, messageKey: null };
    expect(findingIgnoreCovers(legacy, { code: 'js-ai', nodeName: 'Normaliser (v2)' }, nodeIds)).toBe(false);
  });
});
