'use client';

import React from 'react';
import { Button, Segmented, Select, Tooltip } from 'antd';
import type { SelectProps } from 'antd';
import { Filters } from './workflow-filters';

type Options = SelectProps['options'];

/**
 * Filtres de la page Workflows (hors recherche) et bascule de vue. Un seul rendu
 * pour deux dispositions : en ligne sur desktop, empilés pleine largeur dans le
 * tiroir mobile (`block`).
 */
export function WorkflowFilterControls({
  filters,
  setFilters,
  scoped,
  instanceOptions,
  envOptions,
  divergenceOptions,
  groupOptions,
  grouped,
  onGroupedChange,
  onOpenPaths,
  block = false,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  /** Scope global d'instance posé : le sélecteur d'instance est masqué. */
  scoped: boolean;
  instanceOptions: Options;
  envOptions: Options;
  divergenceOptions: Options;
  groupOptions: Options;
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  onOpenPaths: () => void;
  block?: boolean;
}) {
  const set = (field: keyof Filters) => (value?: string) =>
    setFilters((current) => ({ ...current, [field]: value || undefined }));
  const width = (desktop: number) => (block ? '100%' : desktop);

  return (
    <>
      {!scoped && (
        <Select
          placeholder="Instance"
          allowClear
          style={{ width: width(200) }}
          options={instanceOptions}
          value={filters.instanceId}
          onChange={set('instanceId')}
        />
      )}
      <Select
        placeholder="Env"
        allowClear
        style={{ width: width(130) }}
        options={envOptions}
        value={filters.env}
        onChange={set('env')}
      />
      <Select
        placeholder="Écart avec la prod"
        allowClear
        style={{ width: width(210) }}
        options={divergenceOptions}
        value={filters.divergence}
        onChange={set('divergence')}
      />
      {groupOptions && groupOptions.length > 0 && (
        <Select
          placeholder="Groupe"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: width(180) }}
          options={groupOptions}
          value={filters.groupId}
          onChange={set('groupId')}
        />
      )}
      <Select
        placeholder="Statut"
        allowClear
        style={{ width: width(130) }}
        options={[
          { value: 'true', label: 'actifs' },
          { value: 'false', label: 'inactifs' },
        ]}
        value={filters.active}
        onChange={set('active')}
      />
      <Select
        style={{ width: width(200) }}
        value={filters.archived}
        onChange={(value) => setFilters((current) => ({ ...current, archived: value }))}
        options={[
          { value: 'default', label: 'Archivés : par défaut' },
          { value: 'false', label: 'Archivés : masqués' },
          { value: 'all', label: 'Archivés : affichés' },
          { value: 'true', label: 'Archivés seulement' },
        ]}
      />
      <Tooltip title="Copies d’env qui partagent le path de leur original">
        <Button block={block} onClick={onOpenPaths}>
          Points d’entrée partagés…
        </Button>
      </Tooltip>
      {/* Empilée dans le tiroir : côte à côte, « Un par workflow n8n » est tronqué sur 360 px. */}
      <Segmented
        block={block}
        vertical={block}
        value={grouped ? 'grouped' : 'flat'}
        onChange={(value) => onGroupedChange(value === 'grouped')}
        options={[
          { value: 'flat', label: 'Un par workflow n8n' },
          { value: 'grouped', label: 'Groupés par env' },
        ]}
      />
    </>
  );
}
