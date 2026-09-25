/**
 * Comment un tableau se replie en liste sur mobile (`MobileTable`), sans React.
 * Une ligne repliée montre un TITRE (et d'éventuels badges) ; dépliée, les autres
 * colonnes en « libellé : valeur », puis les actions de ligne.
 */

/** Colonne telle que la voit la mise en page : son identité, son libellé, et si c'est une colonne d'actions. */
export interface PlannedColumn {
  id: string;
  label: string;
  actions: boolean;
}

/** Réglage par table (`mobileLayout` de `ResizableTable`), par identité de colonne (`key` ou `dataIndex`). */
export interface MobileLayout {
  /** Colonne affichée en titre de la ligne repliée. Défaut : la première colonne nommée. */
  title?: string;
  /** Colonnes affichées à droite du titre, ligne repliée (tags d'env, statut). */
  badges?: string[];
  /** Colonnes qui n'apparaissent pas sur mobile. */
  hidden?: string[];
}

export interface MobilePlan {
  title: string;
  badges: string[];
  details: string[];
  actions: string[];
}

export function planMobileColumns(columns: PlannedColumn[], layout: MobileLayout = {}): MobilePlan {
  const known = new Set(columns.map((column) => column.id));
  const hidden = new Set(layout.hidden ?? []);
  const shown = columns.filter((column) => !hidden.has(column.id));
  const title =
    (layout.title && known.has(layout.title) ? layout.title : undefined) ??
    shown.find((column) => column.label !== '' && !column.actions)?.id ??
    shown[0]?.id ??
    '';
  const badges = (layout.badges ?? []).filter((id) => known.has(id) && id !== title && !hidden.has(id));
  const placed = new Set([title, ...badges]);
  const rest = shown.filter((column) => !placed.has(column.id));
  return {
    title,
    badges,
    details: rest.filter((column) => !column.actions).map((column) => column.id),
    actions: rest.filter((column) => column.actions).map((column) => column.id),
  };
}

/** Valeur d'une cellule : `dataIndex` simple ou chemin, comme antd. */
export function valueAt(record: unknown, dataIndex: string | number | Array<string | number> | undefined) {
  if (dataIndex === undefined) return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>(
    (current, part) =>
      current !== null && typeof current === 'object'
        ? (current as Record<string | number, unknown>)[part]
        : undefined,
    record,
  );
}

/** Coche ou décoche une clé de ligne. */
export function toggleKey<K>(keys: K[], key: K): K[] {
  return keys.includes(key) ? keys.filter((current) => current !== key) : [...keys, key];
}
