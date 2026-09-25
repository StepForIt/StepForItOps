import { describe, expect, it } from 'vitest';
import { completeDraft } from '../src/domain/chat-completion';

const sources = {
  phrases: [
    'Explique-moi ce que fait ce workflow, étape par étape.',
    'Explique-moi le nœud qui échoue.',
    'Ajoute un retry sur les appels HTTP.',
  ],
  nodeNames: ['HTTP Facturation', 'Envoi Slack'],
};

describe('completeDraft', () => {
  it('propose la suite de la phrase commencée', () => {
    expect(completeDraft('Ajoute un ret', sources)).toBe('ry sur les appels HTTP.');
  });

  it('ignore casse et accents sans décaler la découpe', () => {
    expect(completeDraft('explique-moi le n', sources)).toBe('œud qui échoue.');
  });

  it('choisit la suite la plus courte quand plusieurs phrases commencent pareil', () => {
    expect(completeDraft('Explique-moi ', sources)).toBeNull();
    expect(completeDraft('Explique-moi l', sources)).toBe('e nœud qui échoue.');
  });

  it('complète un nom de nœud sur le dernier mot, faute de phrase', () => {
    expect(completeDraft('ajoute un timeout sur HTTP Fact', sources)).toBe('uration');
  });

  it('se tait sur une frappe trop courte, un espace final ou une ligne vide', () => {
    expect(completeDraft('Aj', sources)).toBeNull();
    expect(completeDraft('Ajoute ', sources)).toBeNull();
    expect(completeDraft('', sources)).toBeNull();
  });

  it('ne raisonne que sur la ligne en cours', () => {
    expect(completeDraft('Contexte\nAjoute un ret', sources)).toBe('ry sur les appels HTTP.');
  });

  it('ne propose rien quand la ligne est déjà la phrase entière', () => {
    expect(completeDraft('Explique-moi le nœud qui échoue.', sources)).toBeNull();
  });
});
