import { describe, expect, it } from 'vitest';
import { rowGesture, selectionToggle, toggleExpanded } from './mobile-gestures';

describe('rowGesture', () => {
  it('déplie la ligne au tap hors du mode sélection', () => {
    expect(rowGesture('tap', false)).toBe('expand');
  });

  it('coche ou décoche au tap une fois le mode sélection ouvert', () => {
    expect(rowGesture('tap', true)).toBe('toggle');
  });

  it("coche à l'appui long, que le mode sélection soit ouvert ou non", () => {
    expect(rowGesture('long', false)).toBe('toggle');
    expect(rowGesture('long', true)).toBe('toggle');
  });
});

describe('toggleExpanded', () => {
  it('ouvre une ligne et referme la précédente : une seule dépliée à la fois', () => {
    expect(toggleExpanded(null, 'a')).toBe('a');
    expect(toggleExpanded('a', 'b')).toBe('b');
  });

  it('referme la ligne dépliée quand on la touche de nouveau', () => {
    expect(toggleExpanded('a', 'a')).toBeNull();
  });
});

describe('selectionToggle', () => {
  const row = { id: 'w1' };

  it('coche une ligne non cochée sans toucher aux autres (scope = la ligne seule)', () => {
    expect(selectionToggle(['w2'], row)).toEqual({ scope: [row], rows: [row] });
  });

  it('décoche une ligne cochée', () => {
    expect(selectionToggle(['w1', 'w2'], row)).toEqual({ scope: [row], rows: [] });
  });
});
