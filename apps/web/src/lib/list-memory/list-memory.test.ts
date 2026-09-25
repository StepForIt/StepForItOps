import { describe, expect, it } from 'vitest';
import {
  arrangeColumns,
  clampPage,
  keysOfList,
  moveColumn,
  normalizeListPath,
  pageKey,
  tableKey,
  toggleColumn,
  validLocalSort,
  validPagination,
  validRefineSorters,
} from './list-memory';

describe('normalizeListPath', () => {
  it('confond les pages de détail de deux objets différents', () => {
    expect(normalizeListPath('/workflows/show/abc12345def')).toBe('/workflows/show/:id');
    expect(normalizeListPath('/instances/show/42')).toBe('/instances/show/:id');
  });

  it('garde les segments qui nomment la page', () => {
    expect(normalizeListPath('/llm-costs')).toBe('/llm-costs');
  });
});

describe('keysOfList', () => {
  it('rend les clés de la page, de ses tables et de leurs largeurs, et rien des pages voisines', () => {
    const keys = [
      pageKey('/workflows'),
      tableKey('/workflows', 'refine:workflows'),
      'nwm.column-widths./workflows::abc',
      pageKey('/workflows-archive'),
      tableKey('/workflow-map', 'x'),
      'nwm.instance-scope',
    ];
    expect(keysOfList(keys, '/workflows').sort()).toEqual(
      [
        pageKey('/workflows'),
        tableKey('/workflows', 'refine:workflows'),
        'nwm.column-widths./workflows::abc',
      ].sort(),
    );
  });
});

describe('arrangeColumns', () => {
  const ids = ['name', 'env', 'active', 'actions'];
  const movable = ['name', 'env', 'active'];

  it("rend l'ordre déclaré sans réglage", () => {
    expect(arrangeColumns(ids, movable, {})).toEqual(ids);
  });

  it('applique ordre et masquage, les colonnes sans nom restant à leur place', () => {
    expect(arrangeColumns(ids, movable, { order: ['active', 'name', 'env'], hidden: ['env'] })).toEqual([
      'active',
      'name',
      'actions',
    ]);
  });

  it('ignore une colonne retenue qui a disparu et place une colonne nouvelle derrière sa voisine déclarée', () => {
    const next = ['name', 'owner', 'env', 'actions'];
    expect(arrangeColumns(next, ['name', 'owner', 'env'], { order: ['env', 'gone', 'name'] })).toEqual([
      'env',
      'name',
      'owner',
      'actions',
    ]);
  });

  it('ne masque jamais toutes les colonnes', () => {
    expect(arrangeColumns(ids, movable, { hidden: movable })).toEqual(ids);
  });
});

describe('moveColumn', () => {
  it('échange avec la voisine', () => {
    expect(moveColumn(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('ne sort pas des bornes', () => {
    expect(moveColumn(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveColumn(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });
});

describe('toggleColumn', () => {
  it('masque puis réaffiche', () => {
    const hidden = toggleColumn({}, 'env', false, ['name', 'env']);
    expect(hidden.hidden).toEqual(['env']);
    expect(toggleColumn(hidden, 'env', true, ['name', 'env']).hidden).toEqual([]);
  });

  it('refuse de masquer la dernière colonne visible', () => {
    expect(toggleColumn({ hidden: ['env'] }, 'name', false, ['name', 'env']).hidden).toEqual(['env']);
  });
});

describe('validLocalSort', () => {
  it('garde un tri sur une colonne triable', () => {
    expect(validLocalSort({ field: 'cost', order: 'descend' }, ['cost'])).toEqual({
      field: 'cost',
      order: 'descend',
    });
  });

  it('écarte une colonne disparue ou un sens inconnu', () => {
    expect(validLocalSort({ field: 'gone', order: 'ascend' }, ['cost'])).toBeUndefined();
    expect(validLocalSort({ field: 'cost', order: 'up' }, ['cost'])).toBeUndefined();
    expect(validLocalSort('n’importe quoi', ['cost'])).toBeUndefined();
  });
});

describe('validRefineSorters', () => {
  it('garde une liste de tris bien formés', () => {
    expect(validRefineSorters([{ field: 'name', order: 'asc' }])).toEqual([{ field: 'name', order: 'asc' }]);
  });

  it('écarte le reste', () => {
    expect(validRefineSorters([{ field: 'name', order: 'ascend' }])).toBeUndefined();
    expect(validRefineSorters({})).toBeUndefined();
  });
});

describe('validPagination', () => {
  it('garde page et taille entières et positives', () => {
    expect(validPagination({ current: 3, pageSize: 50 })).toEqual({ current: 3, pageSize: 50 });
  });

  it('écarte une valeur absurde champ par champ', () => {
    expect(validPagination({ current: -1, pageSize: 50 })).toEqual({ pageSize: 50 });
    expect(validPagination({ current: 2, pageSize: 100000 })).toEqual({ current: 2 });
    expect(validPagination(null)).toEqual({});
  });
});

describe('clampPage', () => {
  it('ramène à la première page une page au-delà du total', () => {
    expect(clampPage(5, 20, 30)).toBe(1);
  });

  it('laisse une page existante, et ne juge pas une liste vide', () => {
    expect(clampPage(2, 20, 30)).toBe(2);
    expect(clampPage(4, 20, 0)).toBe(4);
  });
});
