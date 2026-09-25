'use client';

import { BaseRecord, CrudFilters } from '@refinedev/core';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { useSearchSync } from './use-search-sync';

/**
 * Requête d'une liste de la page Workflows (vue plate `workflows` ou groupée
 * `workflows/families`), commune au tableau desktop et à la liste mobile : même
 * resource, mêmes filtres, même tri retenu, même synchro de rattrapage quand une
 * recherche revient vide. Seul le rendu change d'un écran à l'autre.
 */
export function useWorkflowList<T extends BaseRecord>({
  resource,
  filters,
  search,
  instanceId,
}: {
  resource: 'workflows' | 'workflows/families';
  filters: CrudFilters;
  /** Terme cherché : c'est lui qui autorise la synchro de rattrapage, pas les autres filtres. */
  search?: string;
  instanceId: string | null;
}) {
  const table = useTable<T>({
    resource,
    filters: { permanent: filters },
    sorters: { initial: [{ field: 'name', order: 'asc' }] },
  });
  const { tableQueryResult } = table;
  const syncing = useSearchSync({
    term: search,
    instanceId,
    empty: (tableQueryResult.data?.total ?? 0) === 0,
    ready: !tableQueryResult.isFetching,
    reload: tableQueryResult.refetch,
  });
  const refetch = () => {
    void tableQueryResult.refetch();
  };
  return { ...table, syncing, refetch };
}
