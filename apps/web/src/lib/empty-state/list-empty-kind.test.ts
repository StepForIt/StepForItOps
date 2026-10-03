import { describe, expect, it } from 'vitest';
import { listEmptyKind } from './list-empty-kind';

describe('listEmptyKind', () => {
  it('sans instance, une page du parc propose d’en ajouter une, recherche et filtres compris', () => {
    expect(listEmptyKind({ instanceCount: 0 })).toBe('no-instance');
    expect(listEmptyKind({ instanceCount: 0, search: 'factu', filterCount: 2 })).toBe('no-instance');
  });

  it('une page hors parc ne parle jamais d’instance', () => {
    expect(listEmptyKind({ instanceCount: null })).toBe('idle');
    expect(listEmptyKind({ instanceCount: null, search: 'slack' })).toBe('no-search-match');
  });

  it('une recherche vide ne propose jamais d’ajouter une instance quand il y en a une', () => {
    expect(listEmptyKind({ instanceCount: 2, search: 'factu', filterCount: 3 })).toBe('no-search-match');
  });

  it('une recherche faite d’espaces ne compte pas', () => {
    expect(listEmptyKind({ instanceCount: 1, search: '  ' })).toBe('idle');
  });

  it('des filtres qui écartent tout proposent de les retirer', () => {
    expect(listEmptyKind({ instanceCount: 1, filterCount: 1 })).toBe('no-filter-match');
  });

  it('sans rien de posé, la page dit ce qui lui est propre', () => {
    expect(listEmptyKind({ instanceCount: 1 })).toBe('idle');
  });
});
