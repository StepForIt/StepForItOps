'use client';

import React from 'react';
import { Descriptions, Empty, List, Space } from 'antd';
import type { PaginationProps, TableProps } from 'antd';
import { MobileRow } from './mobile-row';
import { RowEffect, toggleExpanded } from './mobile-gestures';
import { MobileLayout, planMobileColumns, toggleKey, valueAt } from './mobile-table-layout';

// Frontière antd, comme dans `resizable-table.tsx` : une colonne n'y a pas de forme stable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyColumn = Record<string, any>;
type Key = React.Key;

export interface MobileColumn {
  id: string;
  label: string;
  column: AnyColumn;
}

/** Colonne d'actions de ligne : sans titre, intitulée « Actions », ou marquée `row-actions`. */
export function isActionsColumn({ label, column }: MobileColumn): boolean {
  return label === '' || label === 'Actions' || String(column.className ?? '').includes('row-actions');
}

/** Ce qu'une colonne afficherait dans sa cellule, forme `{ children, props }` d'antd comprise. */
function renderCell(column: AnyColumn, record: object, index: number): React.ReactNode {
  const value = valueAt(record, column.dataIndex);
  const rendered = column.render ? column.render(value, record, index) : value;
  if (rendered && typeof rendered === 'object' && !React.isValidElement(rendered) && 'children' in rendered)
    return (rendered as { children: React.ReactNode }).children;
  return rendered as React.ReactNode;
}

function keyOf<T extends object>(record: T, index: number, rowKey: TableProps<T>['rowKey']): Key {
  if (typeof rowKey === 'function') return rowKey(record, index);
  const field = rowKey ?? 'key';
  return (record as Record<string, Key>)[field as string] ?? index;
}

/**
 * Rendu mobile d'un tableau (`ResizableTable` sous le breakpoint `md`) : une ligne
 * repliée par enregistrement — titre + badges —, dépliée au tap sur les autres
 * colonnes, puis ses actions et son éventuel contenu déplié (`expandedRowRender`).
 * Même données, mêmes colonnes, même pagination que le tableau : rien à écrire
 * par page, sauf pour choisir titre et badges (`mobileLayout`).
 *
 * Une table avec cases à cocher les remplace par l'appui long : il ouvre le mode
 * sélection, où le tap coche au lieu de déplier (cf. `mobile-gestures.ts`).
 */
export function MobileTable<T extends object>({
  columns,
  layout,
  dataSource,
  rowKey,
  loading,
  pagination,
  onChange,
  rowSelection,
  expandable,
  locale,
}: {
  columns: MobileColumn[];
  layout?: MobileLayout;
  dataSource?: readonly T[];
  rowKey?: TableProps<T>['rowKey'];
  loading?: TableProps<T>['loading'];
  pagination?: TableProps<T>['pagination'];
  onChange?: TableProps<T>['onChange'];
  rowSelection?: TableProps<T>['rowSelection'];
  expandable?: TableProps<T>['expandable'];
  locale?: TableProps<T>['locale'];
}) {
  const [expandedKey, setExpandedKey] = React.useState<Key | null>(null);
  const [ownSelection, setOwnSelection] = React.useState<Key[]>([]);
  const rows = React.useMemo(() => [...(dataSource ?? [])], [dataSource]);

  const plan = planMobileColumns(
    columns.map((column) => ({ id: column.id, label: column.label, actions: isActionsColumn(column) })),
    layout,
  );
  const byId = new Map(columns.map((column) => [column.id, column]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is MobileColumn => !!c);
  const titleColumn = byId.get(plan.title);
  const badgeColumns = pick(plan.badges);
  const detailColumns = pick(plan.details);
  const actionColumns = pick(plan.actions);

  const selectedKeys = rowSelection ? (rowSelection.selectedRowKeys ?? ownSelection) : [];
  const selecting = selectedKeys.length > 0;
  const toggleSelection = (key: Key, record: T) => {
    if (!rowSelection || rowSelection.getCheckboxProps?.(record)?.disabled) return;
    const keys = toggleKey(selectedKeys, key);
    if (rowSelection.selectedRowKeys === undefined) setOwnSelection(keys);
    const selectedRows = rows.filter((row, index) => keys.includes(keyOf(row, index, rowKey)));
    rowSelection.onChange?.(keys, selectedRows, { type: 'single' });
  };

  const onEffect = (key: Key, record: T) => (effect: RowEffect) => {
    if (effect === 'toggle' && rowSelection) toggleSelection(key, record);
    else if (effect === 'expand') setExpandedKey((current) => toggleExpanded(current, key));
  };

  return (
    <List<T>
      dataSource={rows}
      rowKey={(record) => keyOf(record, rows.indexOf(record), rowKey)}
      loading={loading}
      pagination={listPagination(pagination, onChange)}
      locale={{
        emptyText: (locale?.emptyText as React.ReactNode) ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />,
      }}
      renderItem={(record) => {
        const index = rows.indexOf(record);
        const key = keyOf(record, index, rowKey);
        const expanded = expandedKey === key;
        const extra =
          expanded && expandable?.expandedRowRender && (expandable.rowExpandable?.(record) ?? true)
            ? expandable.expandedRowRender(record, index, 0, true)
            : null;
        return (
          <List.Item style={{ padding: 0 }}>
            <MobileRow
              title={titleColumn ? renderCell(titleColumn.column, record, index) : String(key)}
              badges={
                badgeColumns.length > 0 ? (
                  <Space size={4}>
                    {badgeColumns.map((column) => (
                      <React.Fragment key={column.id}>
                        {renderCell(column.column, record, index)}
                      </React.Fragment>
                    ))}
                  </Space>
                ) : undefined
              }
              expanded={expanded}
              selecting={selecting}
              selected={selectedKeys.includes(key)}
              onEffect={onEffect(key, record)}
            >
              {detailColumns.length > 0 && (
                <Descriptions
                  size="small"
                  column={1}
                  style={{ marginBottom: actionColumns.length > 0 || extra ? 12 : 0 }}
                  items={detailColumns.map((column) => ({
                    key: column.id,
                    label: column.label,
                    children: renderCell(column.column, record, index),
                  }))}
                />
              )}
              {actionColumns.length > 0 && (
                <Space wrap size={8} style={{ marginBottom: extra ? 12 : 0 }}>
                  {actionColumns.map((column) => (
                    <React.Fragment key={column.id}>
                      {renderCell(column.column, record, index)}
                    </React.Fragment>
                  ))}
                </Space>
              )}
              {extra}
            </MobileRow>
          </List.Item>
        );
      }}
    />
  );
}

/**
 * Pagination de la liste. Table pilotée par Refine (`onChange`) : la page vient de
 * l'API, un changement repasse par le même `onChange` que le tableau, sans tri ni
 * filtre — Refine ne touche alors qu'à la page. Table locale : la liste découpe
 * elle-même, 10 par page comme `antd.Table` par défaut.
 */
function listPagination<T>(
  pagination: TableProps<T>['pagination'],
  onChange: TableProps<T>['onChange'],
): PaginationProps | false {
  if (pagination === false) return false;
  const declared = typeof pagination === 'object' ? pagination : {};
  const compact: PaginationProps = { simple: true, size: 'small', align: 'center', hideOnSinglePage: true };
  const scrollTop = () => window.scrollTo({ top: 0 });
  // `List` étale la config sur la sienne : une clé à `undefined` écraserait sa page ou son total.
  const defined = (config: PaginationProps): PaginationProps =>
    Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
  if (onChange) {
    return defined({
      ...compact,
      current: declared.current,
      pageSize: declared.pageSize,
      total: declared.total,
      onChange: (current, pageSize) => {
        onChange({ current, pageSize }, {}, {}, { action: 'paginate', currentDataSource: [] });
        scrollTop();
      },
    });
  }
  return defined({
    ...compact,
    defaultCurrent: declared.defaultCurrent,
    defaultPageSize: declared.defaultPageSize ?? declared.pageSize ?? 10,
    current: declared.current,
    total: declared.total,
    onChange: (current, pageSize) => {
      declared.onChange?.(current, pageSize);
      scrollTop();
    },
  });
}
