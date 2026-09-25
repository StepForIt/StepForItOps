'use client';

import React from 'react';
import { Badge, Button, Drawer, Flex, Input } from 'antd';
import { FilterOutlined } from '@ant-design/icons';

/**
 * En-tête de liste sur mobile : la recherche reste à portée de pouce, les autres
 * filtres passent dans un tiroir par le bas. Le badge dit combien de filtres
 * sont posés — sans lui, une liste raccourcie par un filtre caché se lit comme
 * une liste vide. Les filtres s'appliquent au changement, comme sur desktop :
 * « Appliquer » ne fait que refermer le tiroir.
 */
export function MobileFilterBar({
  search,
  onSearch,
  searchPlaceholder,
  activeCount,
  onReset,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  activeCount: number;
  onReset: () => void;
  /** Contrôles de filtre, empilés pleine largeur dans le tiroir. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Flex gap={8} style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder={searchPlaceholder}
          allowClear
          style={{ flex: 1, minWidth: 0 }}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onSearch={onSearch}
        />
        <Badge count={activeCount} size="small">
          <Button icon={<FilterOutlined />} onClick={() => setOpen(true)}>
            Filtres
          </Button>
        </Badge>
      </Flex>
      <Drawer
        title="Filtres"
        placement="bottom"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ wrapper: { height: 'auto', maxHeight: '85vh' } }}
        footer={
          <Flex gap={8}>
            <Button block onClick={onReset} disabled={activeCount === 0}>
              Réinitialiser
            </Button>
            <Button block type="primary" onClick={() => setOpen(false)}>
              Appliquer
            </Button>
          </Flex>
        }
      >
        <Flex vertical gap={12}>
          {children}
        </Flex>
      </Drawer>
    </>
  );
}
