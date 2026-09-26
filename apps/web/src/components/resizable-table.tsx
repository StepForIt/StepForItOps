'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Table as AntTable } from 'antd';
import type { TableProps } from 'antd';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  arrangeColumns,
  moveColumn,
  normalizeListPath,
  tableKey,
  toggleColumn,
  validLocalSort,
  validPagination,
  WIDTHS_PREFIX,
  type ColumnLayout,
} from '../lib/list-memory/list-memory';
import { readJson, removeKey, resetListView, writeJson } from '../lib/list-memory/use-list-memory';
import { ColumnsMenu } from './columns-menu';
import { MobileTable } from './mobile/mobile-table';
import { useIsMobile } from './mobile/use-is-mobile';
import type { MobileLayout } from './mobile/mobile-table-layout';

/**
 * Table antd qui retient comment on l'a laissée (cf. `lib/list-memory`) :
 * - la largeur des colonnes, en tirant la bordure des en-têtes ;
 * - les colonnes affichées et leur ordre, par le menu « Colonnes » du coin droit ;
 * - pour une table LOCALE (données déjà chargées, tri fait par antd), le tri, la
 *   page et la taille de page. Une table pilotée par Refine (`onChange` fourni)
 *   garde les siens dans `useTable` de `lib/list-memory`, qui les porte jusqu'à l'API.
 *
 * Ni Refine ni antd ne fournissent le redimensionnement : antd documente le cas
 * comme un exemple à recopier (composant `header.cell` maison + react-resizable).
 * C'est fait ici sans dépendance, avec les événements pointer.
 *
 * L'usage est un remplacement de `Table` : `import { Table } from '.../resizable-table'`.
 * La clé de rangement est déduite de l'URL et des colonnes, pour n'avoir rien à
 * déclarer à chaque table ; `resizeKey` la fixe à la main quand deux tables d'une
 * même page partagent leurs colonnes.
 *
 * Sur mobile (sous le breakpoint `md`), une table d'au moins `MOBILE_MIN_COLUMNS`
 * colonnes se rend en liste de lignes dépliables (`MobileTable`) : un tableau de
 * sept colonnes dans 360 px ne se lit qu'en défilant de côté. Mêmes colonnes (celles
 * choisies au menu comprises), mêmes données, même pagination ; `mobileLayout`
 * choisit le titre et les badges de la ligne repliée, `mobile={false}` garde le tableau.
 */

const MIN_WIDTH = 60;
const MENU_ID = '__columns';
const MENU_WIDTH = 44;
/** Au-dessous, il n'y a pas assez de colonnes pour qu'en choisir vaille un bouton de plus. */
const MENU_MIN_COLUMNS = 4;
const STYLE_ID = 'nwm-resize-handle-style';
/** En dessous, le tableau tient dans un écran de téléphone : on le garde. */
const MOBILE_MIN_COLUMNS = 4;

// Frontière antd : une colonne de `Table` n'a pas de forme stable côté
// bibliothèque, et la retyper ici mentirait sur ce qu'on en sait.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyColumn = Record<string, any>;

/** Identité d'une colonne : ce qui la retrouve d'une session à l'autre. */
function columnId(col: AnyColumn | undefined, index: number): string {
  const raw = col?.key ?? col?.dataIndex;
  const id = Array.isArray(raw) ? raw.join('.') : raw;
  if (id !== undefined && id !== null && id !== '') return String(id);
  if (typeof col?.title === 'string' && col.title) return `t:${col.title}`;
  return `#${index}`;
}

/** Texte d'un titre de colonne, même enveloppé dans une infobulle : c'est le nom montré dans le menu. */
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('').trim();
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

/** Empreinte courte d'une liste de colonnes (djb2), pour distinguer deux tables d'une page. */
function signature(ids: string[]): string {
  let hash = 5381;
  const source = ids.join('|');
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function readWidths(key: string): Record<string, number> {
  const stored = readJson(key);
  return stored && typeof stored === 'object' ? (stored as Record<string, number>) : {};
}

function writeWidths(key: string, widths: Record<string, number>) {
  if (Object.keys(widths).length === 0) removeKey(key);
  else writeJson(key, widths);
}

/** Ce qu'une table retient en plus de ses largeurs. */
interface TableMemory {
  layout?: ColumnLayout;
  sort?: unknown;
  current?: number;
  pageSize?: number;
}

function readMemory(key: string): TableMemory {
  const stored = readJson(key);
  return stored && typeof stored === 'object' ? (stored as TableMemory) : {};
}

/** Un état relu au premier rendu, et relu encore quand sa clé change (colonnes ajoutées, autre page). */
function useKeyedStore<T>(key: string, read: (key: string) => T): [T, (next: T) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const value = state.key === key ? state.value : read(key);
  const set = useCallback((next: T) => setState({ key, value: next }), [key]);
  return [value, set];
}

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nwm-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  width: 9px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  z-index: 2;
}
.nwm-resize-handle::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: 4px;
  width: 1px;
  background: transparent;
}
.nwm-resize-handle:hover::after,
.nwm-resize-handle.nwm-resizing::after {
  background: var(--ant-color-primary, #047a76);
}
`;
  document.head.appendChild(style);
}

interface ResizeInfo {
  id: string;
  onStart: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  onReset: (id: string) => void;
}

function ResizableHeaderCell({
  __resize,
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLTableCellElement> & { __resize?: ResizeInfo }) {
  const t = useTranslations('shell.resizableTable');
  if (!__resize) {
    return (
      <th {...rest} style={style}>
        {children}
      </th>
    );
  }
  return (
    <th {...rest} style={{ ...style, position: 'relative' }}>
      {children}
      <span
        className="nwm-resize-handle"
        title={t('resizeHandle')}
        onPointerDown={(event) => {
          // Sans cela le clic déclenche le tri de la colonne.
          event.preventDefault();
          event.stopPropagation();
          __resize.onStart(__resize.id, event);
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          __resize.onReset(__resize.id);
        }}
      />
    </th>
  );
}

/** Aplatit les enfants `<Table.Column>` comme antd le fait lui-même (tableaux, faux, fragments ignorés). */
function flattenChildren(children: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) out.push(child);
  });
  return out;
}

export interface ResizableTableProps<RecordType> extends TableProps<RecordType> {
  /** Clé de rangement explicite (sinon déduite de l'URL et des colonnes). */
  resizeKey?: string;
  /** Coupe le redimensionnement pour cette table. */
  resizable?: boolean;
  /** Menu « Colonnes ». Par défaut dès 4 colonnes nommées, hors tables compactes (`size="small"`). */
  columnsMenu?: boolean;
  /** Rendu en liste sur mobile. Par défaut dès `MOBILE_MIN_COLUMNS` colonnes, ou dès qu'un `mobileLayout` est donné. */
  mobile?: boolean;
  /** Titre, badges et colonnes masquées de la ligne repliée sur mobile, par identité de colonne. */
  mobileLayout?: MobileLayout;
}

// Même frontière : le défaut générique est celui d'antd.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ResizableTable<RecordType extends object = any>({
  resizeKey,
  resizable = true,
  columnsMenu,
  mobile,
  mobileLayout,
  columns,
  children,
  components,
  tableLayout,
  scroll,
  pagination,
  onChange,
  ...rest
}: ResizableTableProps<RecordType>) {
  const listPath = normalizeListPath(usePathname() ?? '');
  const narrow = useIsMobile();
  // Classe marqueur plutôt qu'un div englobant : une table est souvent posée dans
  // une grille ou une carte, où un élément de plus déplacerait la mise en page.
  const scopeClass = `nwm-rt-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Largeur des colonnes que la table ajoute d'elle-même (sélection, dépliage) :
  // elles comptent dans le total, sinon la table serait rognée d'autant.
  const [extraWidth, setExtraWidth] = useState(0);

  const childColumns = useMemo(() => (columns ? [] : flattenChildren(children)), [columns, children]);
  const declared = useMemo<AnyColumn[]>(
    () =>
      columns
        ? (columns as AnyColumn[])
        : // La clé d'un `<Table.Column>` n'est pas dans ses props : React refuse qu'on l'y lise.
          childColumns.map((child) => ({ ...(child.props as AnyColumn), key: child.key ?? undefined })),
    [columns, childColumns],
  );
  const ids = useMemo(() => declared.map((col, index) => columnId(col, index)), [declared]);
  const tableId = resizeKey ?? signature(ids);

  // Clé historique des largeurs, inchangée pour ne pas perdre celles déjà réglées.
  const widthsKey = WIDTHS_PREFIX + (resizeKey ?? `${listPath}::${tableId}`);
  const memoryKey = tableKey(listPath, `table:${tableId}`);
  const [widths, setWidthsState] = useKeyedStore(widthsKey, (key) => (resizable ? readWidths(key) : {}));
  const [memory, setMemoryState] = useKeyedStore(memoryKey, readMemory);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const memoryRef = useRef(memory);
  memoryRef.current = memory;

  const saveMemory = useCallback(
    (patch: Partial<TableMemory>) => {
      const next = { ...memoryRef.current, ...patch };
      memoryRef.current = next;
      setMemoryState(next);
      writeJson(memoryKey, next);
    },
    [memoryKey, setMemoryState],
  );

  // --- Colonnes affichées ---
  const labels = useMemo(() => declared.map((col) => textOf(col.title)), [declared]);
  const movable = useMemo(() => ids.filter((_, index) => labels[index] !== ''), [ids, labels]);
  const menuOn = columnsMenu ?? (movable.length >= MENU_MIN_COLUMNS && rest.size !== 'small');
  const layout = memory.layout ?? {};
  const shownIds = useMemo(
    () => (menuOn ? arrangeColumns(ids, movable, layout) : ids),
    // `layout` est relu à chaque rendu : c'est son contenu qui compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuOn, ids, movable, JSON.stringify(layout)],
  );

  // --- Tri et page d'une table locale ---
  // `onChange` fourni = la table est pilotée de l'extérieur (Refine) : on n'y touche pas.
  const local = !onChange;
  const sortable = useMemo(
    () => ids.filter((_, index) => declared[index].sorter && declared[index].sortOrder === undefined),
    [ids, declared],
  );
  const storedSort = local ? validLocalSort(memory.sort, sortable) : undefined;

  useEffect(() => {
    ensureStyle();
  }, []);

  /** Largeurs réellement à l'écran : point de départ des colonnes qui n'en déclarent aucune. */
  const measure = useCallback((): Record<string, number> => {
    const root = document.querySelector(`.${scopeClass}`);
    if (!root) return {};
    const cells = Array.from(root.querySelectorAll<HTMLTableCellElement>('.ant-table-thead > tr > th'));
    const dataCells = menuOn ? cells.slice(0, -1) : cells;
    // Les colonnes de sélection et de dépliage sont ajoutées en tête : on aligne par la fin.
    const offset = dataCells.length - shownIds.length;
    if (offset < 0) return {};
    setExtraWidth(
      dataCells.slice(0, offset).reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0),
    );
    const measured: Record<string, number> = {};
    shownIds.forEach((id, index) => {
      const width = dataCells[offset + index]?.getBoundingClientRect().width;
      if (width) measured[id] = Math.round(width);
    });
    return measured;
  }, [shownIds, scopeClass, menuOn]);

  // Les colonnes ajoutées par la table ne se mesurent qu'une fois dessinée.
  useEffect(() => {
    if (!resizable) return undefined;
    const frame = window.requestAnimationFrame(() => measure());
    return () => window.cancelAnimationFrame(frame);
  }, [resizable, measure]);

  const onStart = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      const startX = event.clientX;
      // Toutes les colonnes sont figées à leur largeur du moment : sans cela, élargir
      // l'une ferait bouger toutes les autres à sa place.
      const base = { ...measure(), ...widthsRef.current };
      const startWidth = base[id] ?? MIN_WIDTH;
      const handle = event.currentTarget;
      handle.classList.add('nwm-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      let frame = 0;
      let next = startWidth;
      const apply = () => {
        frame = 0;
        setWidthsState({ ...base, [id]: next });
      };
      const onMove = (moveEvent: PointerEvent) => {
        next = Math.max(MIN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
        if (!frame) frame = window.requestAnimationFrame(apply);
      };
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (frame) window.cancelAnimationFrame(frame);
        handle.classList.remove('nwm-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const final = { ...base, [id]: next };
        setWidthsState(final);
        writeWidths(widthsKey, final);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [measure, widthsKey, setWidthsState],
  );

  const onReset = useCallback(
    (id: string) => {
      const next = { ...widthsRef.current };
      delete next[id];
      setWidthsState(next);
      writeWidths(widthsKey, next);
    },
    [widthsKey, setWidthsState],
  );

  const decorate = useCallback(
    (col: AnyColumn, index: number): AnyColumn => {
      const id = ids[index];
      const decorated: AnyColumn = { ...col, __memoryId: id };
      if (resizable) {
        const origin = col.onHeaderCell;
        decorated.width = widths[id] ?? col.width;
        decorated.onHeaderCell = (column: AnyColumn) => ({
          ...(origin ? origin(column) : {}),
          __resize: { id, onStart, onReset } satisfies ResizeInfo,
        });
      }
      // Le tri retenu remplace le tri par défaut déclaré : un seul tri à la fois.
      if (storedSort && sortable.includes(id)) {
        decorated.defaultSortOrder = id === storedSort.field ? storedSort.order : undefined;
      }
      return decorated;
    },
    [ids, resizable, widths, onStart, onReset, storedSort, sortable],
  );

  const menu = menuOn ? (
    <ColumnsMenu
      items={[
        ...shownIds.filter((id) => movable.includes(id)),
        ...movable.filter((id) => !shownIds.includes(id)),
      ].map((id) => ({ id, label: labels[ids.indexOf(id)], visible: shownIds.includes(id) }))}
      onToggle={(id, visible) => saveMemory({ layout: toggleColumn(layout, id, visible, movable) })}
      onMove={(id, delta) => {
        // L'ordre de départ est celui qu'on voit, masquées rangées à la fin comme dans le menu.
        const current = [
          ...shownIds.filter((shown) => movable.includes(shown)),
          ...movable.filter((col) => !shownIds.includes(col)),
        ];
        saveMemory({ layout: { ...layout, order: moveColumn(current, id, delta) } });
      }}
      onResetColumns={() => saveMemory({ layout: undefined })}
      onResetView={() => resetListView(listPath)}
    />
  ) : null;
  const menuColumn: AnyColumn = {
    title: menu,
    width: MENU_WIDTH,
    align: 'right',
    render: () => null,
  };

  const shownColumns = useMemo(() => {
    if (!columns) return columns;
    const out = shownIds.map((id) => decorate((columns as AnyColumn[])[ids.indexOf(id)], ids.indexOf(id)));
    return menuOn ? [...out, { key: MENU_ID, ...menuColumn }] : out;
    // `menuColumn` se refait à chaque rendu avec le menu, qui en dépend déjà.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, shownIds, ids, decorate, menuOn, menu]);

  const shownChildren = useMemo(() => {
    if (columns) return children;
    const out = shownIds.map((id) => {
      const index = ids.indexOf(id);
      const child = childColumns[index];
      return React.cloneElement(child, { ...decorate(declared[index], index), key: child.key ?? id });
    });
    return menuOn ? [...out, <AntTable.Column key={MENU_ID} {...menuColumn} />] : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, children, childColumns, declared, shownIds, ids, decorate, menuOn, menu]);

  // Pagination d'une table locale : page et taille retenues deviennent les valeurs
  // de départ d'antd, qui reste maître du reste (clamp au dernier numéro compris).
  const mergedPagination = useMemo<TableProps<RecordType>['pagination']>(() => {
    if (!local || pagination === false) return pagination;
    const declaredPagination = typeof pagination === 'object' ? pagination : {};
    if (declaredPagination.current !== undefined) return pagination;
    const stored = validPagination(memory);
    const { pageSize: declaredSize, ...others } = declaredPagination;
    const defaultPageSize = stored.pageSize ?? declaredSize ?? declaredPagination.defaultPageSize;
    const defaultCurrent = stored.current ?? declaredPagination.defaultCurrent;
    return {
      ...others,
      ...(defaultPageSize !== undefined ? { defaultPageSize } : {}),
      ...(defaultCurrent !== undefined ? { defaultCurrent } : {}),
    };
    // Relu au montage seulement : antd tient ensuite la page lui-même.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, pagination]);

  const handleChange = useCallback<NonNullable<TableProps<RecordType>['onChange']>>(
    (nextPagination, _filters, sorter) => {
      const first = Array.isArray(sorter) ? sorter[0] : sorter;
      const field = (first?.column as AnyColumn | undefined)?.__memoryId ?? first?.columnKey;
      saveMemory({
        sort: first?.order && field ? { field: String(field), order: first.order } : undefined,
        ...(pagination === false
          ? {}
          : { current: nextPagination.current, pageSize: nextPagination.pageSize }),
      });
    },
    [saveMemory, pagination],
  );

  const hasWidths = resizable && Object.keys(widths).length > 0;
  const mergedComponents = useMemo(
    () =>
      resizable
        ? { ...components, header: { ...components?.header, cell: ResizableHeaderCell } }
        : components,
    [resizable, components],
  );

  if (narrow && (mobile ?? (declared.length >= MOBILE_MIN_COLUMNS || mobileLayout !== undefined))) {
    return (
      <MobileTable<RecordType>
        columns={shownIds.map((id) => {
          const index = ids.indexOf(id);
          return { id, label: labels[index], column: declared[index] };
        })}
        layout={mobileLayout}
        dataSource={rest.dataSource}
        rowKey={rest.rowKey}
        loading={rest.loading}
        pagination={pagination}
        onChange={onChange}
        rowSelection={rest.rowSelection}
        expandable={rest.expandable}
        locale={rest.locale}
      />
    );
  }

  return (
    <AntTable<RecordType>
      {...(rest as TableProps<RecordType>)}
      className={[scopeClass, rest.className].filter(Boolean).join(' ')}
      columns={shownColumns as TableProps<RecordType>['columns']}
      components={mergedComponents}
      pagination={mergedPagination}
      onChange={local ? handleChange : onChange}
      // Une largeur ne tient que sous `fixed` ; le total en `scroll.x` évite que le
      // navigateur ne rogne les colonnes pour rentrer dans la page.
      tableLayout={tableLayout ?? (hasWidths ? 'fixed' : undefined)}
      scroll={
        hasWidths
          ? {
              ...scroll,
              // `x: true` (posé par Refine) laisse le navigateur rétrécir les colonnes
              // pour tenir dans la page : on lui donne le total voulu à la place.
              x:
                typeof scroll?.x === 'number'
                  ? scroll.x
                  : Math.round(
                      extraWidth +
                        (menuOn ? MENU_WIDTH : 0) +
                        shownIds.reduce((sum, id) => sum + (widths[id] ?? MIN_WIDTH), 0),
                    ),
            }
          : scroll
      }
    >
      {shownChildren}
    </AntTable>
  );
}

/** Même surface que `antd.Table` (Column, ColumnGroup, Summary…) pour un remplacement direct. */
export const Table = Object.assign(ResizableTable, AntTable) as typeof ResizableTable & {
  Column: typeof AntTable.Column;
  ColumnGroup: typeof AntTable.ColumnGroup;
  Summary: typeof AntTable.Summary;
  EXPAND_COLUMN: typeof AntTable.EXPAND_COLUMN;
  SELECTION_ALL: typeof AntTable.SELECTION_ALL;
  SELECTION_INVERT: typeof AntTable.SELECTION_INVERT;
  SELECTION_NONE: typeof AntTable.SELECTION_NONE;
};
