import type { PaginationProps } from 'antd';

/**
 * Pagination compacte d'une liste mobile, branchée sur l'état de `useTable` :
 * page et taille retenues comme pour le tableau desktop (`list-memory`).
 */
export function mobilePagination(list: {
  current: number;
  pageSize: number;
  setCurrent: (page: number) => void;
  tableQueryResult: { data?: { total?: number } };
}): PaginationProps {
  return {
    current: list.current,
    pageSize: list.pageSize,
    total: list.tableQueryResult.data?.total ?? 0,
    onChange: (page) => {
      list.setCurrent(page);
      window.scrollTo({ top: 0 });
    },
    simple: true,
    size: 'small',
    align: 'center',
    hideOnSinglePage: true,
  };
}
