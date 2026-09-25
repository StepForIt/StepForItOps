import { Response } from 'express';

export interface RefineListQuery {
  _start?: string;
  _end?: string;
  _sort?: string;
  _order?: string;
  [key: string]: string | undefined;
}

type SortOrder = 'asc' | 'desc';
/** orderBy Prisma, éventuellement imbriqué (ex. `workflow.name` → { workflow: { name: 'asc' } }). */
export type PrismaOrderBy = { [field: string]: SortOrder | PrismaOrderBy };

export interface PrismaListArgs {
  skip?: number;
  take?: number;
  orderBy?: PrismaOrderBy;
}

/** Convertit la query Refine simple-rest (?_start&_end&_sort&_order) en args Prisma. */
export function toPrismaListArgs(
  query: RefineListQuery,
  defaultSort = 'createdAt',
  defaultOrder: 'asc' | 'desc' = 'desc',
): PrismaListArgs {
  const start = query._start !== undefined ? Number(query._start) : undefined;
  const end = query._end !== undefined ? Number(query._end) : undefined;
  const sort = query._sort ?? defaultSort;
  const order =
    query._order !== undefined ? (query._order.toLowerCase() === 'asc' ? 'asc' : 'desc') : defaultOrder;
  const orderBy = sort
    .split('.')
    .reduceRight<SortOrder | PrismaOrderBy>((acc, key) => ({ [key]: acc }), order) as PrismaOrderBy;
  return {
    skip: start,
    take: start !== undefined && end !== undefined ? end - start : undefined,
    orderBy,
  };
}

/** Pose le header x-total-count attendu par le dataProvider simple-rest. */
export function withTotalCount<T>(res: Response, total: number, data: T): T {
  res.setHeader('x-total-count', String(total));
  return data;
}
