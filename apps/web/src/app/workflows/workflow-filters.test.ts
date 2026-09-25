import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, activeFilterCount } from './workflow-filters';

describe('activeFilterCount', () => {
  it('ne compte rien sur les filtres par défaut', () => {
    expect(activeFilterCount(DEFAULT_FILTERS, { scoped: false })).toBe(0);
  });

  it('compte chaque filtre posé du tiroir, le réglage des archivés compris dès qu’il quitte « par défaut »', () => {
    expect(
      activeFilterCount(
        { archived: 'all', env: 'dev', divergence: 'behind', active: 'true', groupId: 'g', instanceId: 'i' },
        { scoped: false },
      ),
    ).toBe(6);
  });

  it('ne compte pas la recherche : elle reste visible au-dessus de la liste', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: 'factu' }, { scoped: false })).toBe(0);
  });

  it("ignore l'instance retenue quand le scope global la masque", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, instanceId: 'i' }, { scoped: true })).toBe(0);
  });
});
