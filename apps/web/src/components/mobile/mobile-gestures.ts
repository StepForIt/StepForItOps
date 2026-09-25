/**
 * Gestes de la liste mobile, sans React : ce qu'un tap ou un appui long fait
 * d'une ligne. Calqué sur Gmail / Google Photos : le tap déplie, l'appui long
 * ouvre le mode sélection, où le tap coche au lieu de déplier.
 */

export type RowPress = 'tap' | 'long';
export type RowEffect = 'expand' | 'toggle';

export function rowGesture(press: RowPress, selecting: boolean): RowEffect {
  return press === 'long' || selecting ? 'toggle' : 'expand';
}

/** Une seule ligne dépliée à la fois ; la retoucher la replie. */
export function toggleExpanded<K>(current: K | null, id: K): K | null {
  return current === id ? null : id;
}

/**
 * Arguments de `onSelect` (cf. `WorkflowSelection`) pour cocher ou décocher UNE
 * ligne : le scope est la ligne seule, pour que le reste de la sélection tienne.
 */
export function selectionToggle<T extends { id: string }>(
  selectedIds: string[],
  row: T,
): { scope: T[]; rows: T[] } {
  return { scope: [row], rows: selectedIds.includes(row.id) ? [] : [row] };
}
