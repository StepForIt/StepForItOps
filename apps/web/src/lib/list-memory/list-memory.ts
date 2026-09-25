/**
 * Mémoire des listes : ce qui fait qu'on retrouve une liste comme on l'a laissée
 * (filtres, tri, page, vue, colonnes affichées et leur ordre).
 *
 * Tout est rangé dans le localStorage, par navigateur, sous une clé déduite de la
 * page. Ce fichier est PUR — clés, validation de ce qu'on relit, rangement des
 * colonnes — pour être testé sans navigateur ; les hooks sont dans `use-list-memory.tsx`.
 *
 * Ce qu'on relit est toujours validé : une colonne supprimée, un sens de tri
 * inconnu ou une page absurde sont ignorés sans erreur, jamais servis à la table.
 */

export const LIST_PREFIX = 'nwm.list.';
/** Préfixe historique des largeurs (`resizable-table.tsx`), gardé pour ne pas perdre celles déjà réglées. */
export const WIDTHS_PREFIX = 'nwm.column-widths.';

const MAX_PAGE_SIZE = 500;

/** `/workflows/show/abc123` et `/workflows/show/def456` sont la même liste. */
export function normalizeListPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (/^[0-9]+$/.test(segment) || /[0-9a-f]{8}/i.test(segment) ? ':id' : segment))
    .join('/');
}

/** Réglages propres à la page (filtres, vue, switches). */
export function pageKey(path: string): string {
  return `${LIST_PREFIX}${path}`;
}

/** Réglages d'une table de la page — une page peut en porter plusieurs. */
export function tableKey(path: string, suffix: string): string {
  return `${LIST_PREFIX}${path}::${suffix}`;
}

/** Les clés qu'efface « Réinitialiser la vue » : la page, ses tables et leurs largeurs. */
export function keysOfList(keys: string[], path: string): string[] {
  const own = [pageKey(path), `${WIDTHS_PREFIX}${path}`];
  return keys.filter((key) => own.some((base) => key === base || key.startsWith(`${base}::`)));
}

export interface ColumnLayout {
  /** Ordre des colonnes déplaçables, tel que réglé. */
  order?: string[];
  hidden?: string[];
}

/**
 * Colonnes à afficher, dans l'ordre. Seules les colonnes `movable` (celles qui ont un
 * nom à montrer dans le menu) se réordonnent ou se masquent, et elles le font dans
 * les emplacements qu'elles occupaient : une colonne d'actions reste en bout de ligne.
 * Une colonne retenue qui a disparu est ignorée ; une colonne nouvelle garde son rang déclaré.
 */
export function arrangeColumns(ids: string[], movable: string[], layout: ColumnLayout): string[] {
  const movableSet = new Set(movable);
  const declared = ids.filter((id) => movableSet.has(id));
  const known = (layout.order ?? []).filter((id) => movableSet.has(id));
  const ordered = [...known];
  declared.forEach((id, index) => {
    if (ordered.includes(id)) return;
    // Une colonne que le réglage ne connaît pas s'insère après celle qui la précédait.
    const before = declared
      .slice(0, index)
      .reverse()
      .find((prev) => ordered.includes(prev));
    ordered.splice(before === undefined ? 0 : ordered.indexOf(before) + 1, 0, id);
  });

  const hidden = new Set((layout.hidden ?? []).filter((id) => movableSet.has(id)));
  // Tout masquer laisserait une table sans colonne et sans moyen d'en revenir.
  const visible = ordered.filter((id) => !hidden.has(id));
  const shown = visible.length > 0 ? visible : ordered;

  let next = 0;
  return ids.flatMap((id) => {
    if (!movableSet.has(id)) return [id];
    const slot = next < shown.length ? [shown[next]] : [];
    next += 1;
    return slot;
  });
}

export function moveColumn(order: string[], id: string, delta: -1 | 1): string[] {
  const index = order.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toggleColumn(
  layout: ColumnLayout,
  id: string,
  visible: boolean,
  movable: string[],
): ColumnLayout {
  const hidden = new Set(layout.hidden ?? []);
  if (visible) hidden.delete(id);
  else {
    const remaining = movable.filter((col) => col !== id && !hidden.has(col));
    if (remaining.length === 0) return layout;
    hidden.add(id);
  }
  return { ...layout, hidden: [...hidden] };
}

export interface LocalSort {
  field: string;
  order: 'ascend' | 'descend';
}

/** Tri d'une table antd locale, gardé seulement si la colonne existe encore et se trie. */
export function validLocalSort(stored: unknown, sortable: string[]): LocalSort | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const { field, order } = stored as Record<string, unknown>;
  if (typeof field !== 'string' || !sortable.includes(field)) return undefined;
  if (order !== 'ascend' && order !== 'descend') return undefined;
  return { field, order };
}

export interface RefineSort {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Tris d'un `useTable` Refine. Le champ n'est pas vérifiable ici (seule l'API sait
 * ce qu'elle trie) : un champ refusé se rattrape au premier échec de requête.
 */
export function validRefineSorters(stored: unknown): RefineSort[] | undefined {
  if (!Array.isArray(stored) || stored.length === 0) return undefined;
  const valid = stored.every(
    (sort) =>
      sort &&
      typeof sort === 'object' &&
      typeof sort.field === 'string' &&
      sort.field !== '' &&
      (sort.order === 'asc' || sort.order === 'desc'),
  );
  return valid ? stored.map(({ field, order }) => ({ field, order })) : undefined;
}

function positiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : undefined;
}

export function validPagination(stored: unknown): { current?: number; pageSize?: number } {
  if (!stored || typeof stored !== 'object') return {};
  const record = stored as Record<string, unknown>;
  const current = positiveInt(record.current);
  const pageSize = positiveInt(record.pageSize, MAX_PAGE_SIZE);
  return {
    ...(current !== undefined ? { current } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
  };
}

/** Une page retenue au-delà du total (la liste a rétréci) retombe à 1 plutôt que de montrer une page vide. */
export function clampPage(current: number, pageSize: number, total: number): number {
  if (total <= 0) return current;
  return current > Math.ceil(total / pageSize) ? 1 : current;
}
