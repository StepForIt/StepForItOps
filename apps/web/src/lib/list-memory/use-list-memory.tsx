'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTable as useRefineTable } from '@refinedev/antd';
import type { useTableProps, useTableReturnType } from '@refinedev/antd';
import type { BaseRecord, HttpError } from '@refinedev/core';
import {
  clampPage,
  keysOfList,
  normalizeListPath,
  pageKey,
  tableKey,
  validPagination,
  validRefineSorters,
} from './list-memory';

/**
 * Les trois points d'accroche de la mémoire des listes (cf. `list-memory.ts`) :
 * - `usePersistedState` remplace un `useState` de filtre, de vue ou de switch ;
 * - `useTable` remplace celui de `@refinedev/antd` et retient tri, page et taille de page ;
 * - `ResizableTable` (composant) retient largeurs, colonnes, tri et page des tables locales.
 *
 * Les pages ne se montent qu'une fois le scope d'instance relu (`InstanceScopeGate`),
 * donc côté navigateur : la mémoire se lit au PREMIER rendu et part dans la première
 * requête, sans second chargement.
 *
 * L'URL gagne toujours : Refine préfère déjà ses paramètres à l'état initial, et un
 * filtre de page adossé à un paramètre (`urlParam`) ne se restaure pas quand le lien
 * le porte. On n'écrit qu'au geste de l'utilisateur, jamais à l'ouverture : un lien
 * partagé montre ce qu'il vise sans écraser la mémoire de celui qui l'ouvre.
 */

export function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* navigation privée ou quota plein : le réglage vaut pour la visite, sans plus. */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* rien à retirer si le stockage est refusé */
  }
}

export function useListPath(): string {
  return normalizeListPath(usePathname() ?? '');
}

/** Efface tout ce que la page a retenu et la recharge nue, URL comprise. */
export function resetListView(path: string): void {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    );
    keysOfList(
      keys.filter((key): key is string => key !== null),
      path,
    ).forEach(removeKey);
  } catch {
    /* stockage refusé : il n'y avait rien de retenu */
  }
  window.location.replace(window.location.pathname);
}

function readPageField(path: string, name: string): unknown {
  const stored = readJson(pageKey(path));
  return stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[name] : undefined;
}

function writePageField(path: string, name: string, value: unknown): void {
  const stored = readJson(pageKey(path));
  const next = stored && typeof stored === 'object' ? { ...(stored as Record<string, unknown>) } : {};
  if (value === undefined) delete next[name];
  else next[name] = value;
  writeJson(pageKey(path), next);
}

/** Même type que la valeur par défaut : suffisant pour les chaînes, booléens, nombres et listes de chaînes. */
function sameShape<T>(initial: T) {
  return (value: unknown): T | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(initial)) return Array.isArray(value) ? (value as T) : undefined;
    if (initial === null || initial === undefined) return value as T;
    return typeof value === typeof initial ? (value as T) : undefined;
  };
}

export interface PersistedStateOptions<T> {
  /** Paramètre d'URL qui porte déjà ce réglage : présent, il l'emporte sur la mémoire. */
  urlParam?: string;
  /** Rend la valeur relue si elle est encore valable, `undefined` sinon. */
  validate?: (value: unknown) => T | undefined;
}

/**
 * `useState` retenu par page. `name` doit être stable et unique dans la page ;
 * `undefined` efface le réglage (retour au défaut).
 */
export function usePersistedState<T>(
  name: string,
  initial: T,
  options: PersistedStateOptions<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const path = useListPath();
  const { urlParam, validate = sameShape(initial) } = options;
  const [value, setValue] = useState<T>(() => {
    if (urlParam && new URLSearchParams(window.location.search).has(urlParam)) return initial;
    return validate(readPageField(path, name)) ?? initial;
  });
  const set = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (action) =>
      setValue((previous) => {
        const next = typeof action === 'function' ? (action as (prev: T) => T)(previous) : action;
        // Un setter rappelé à l'identique (effet de montage, recherche relancée) n'est pas un geste.
        if (JSON.stringify(next) !== JSON.stringify(previous)) writePageField(path, name, next);
        return next;
      }),
    [path, name],
  );
  return [value, set];
}

interface RefineMemory {
  sorters?: unknown;
  current?: number;
  pageSize?: number;
}

/**
 * `useTable` de `@refinedev/antd`, qui retient tri, page et taille de page. Les filtres
 * n'y sont pas : ils appartiennent aux contrôles de la page (`usePersistedState`), qui
 * les reposent eux-mêmes — retenus aux deux endroits, ils finiraient par se contredire.
 */
export function useTable<
  TQueryFnData extends BaseRecord = BaseRecord,
  TError extends HttpError = HttpError,
  TSearchVariables = unknown,
  TData extends BaseRecord = TQueryFnData,
>(
  props: useTableProps<TQueryFnData, TError, TSearchVariables, TData> & {
    /** Distingue deux tables d'une même ressource sur une page. */
    memoryKey?: string;
  } = {},
): useTableReturnType<TData, TError, TSearchVariables> {
  const { memoryKey, ...tableProps } = props;
  const path = useListPath();
  const key = tableKey(path, memoryKey ?? `refine:${tableProps.resource ?? 'default'}`);
  const paginated = tableProps.pagination?.mode !== 'off';

  const [memory] = useState<RefineMemory>(() => {
    const stored = readJson(key);
    return stored && typeof stored === 'object' ? (stored as RefineMemory) : {};
  });
  const storedSorters = validRefineSorters(memory.sorters);
  const storedPage = paginated ? validPagination(memory) : {};
  const restored = useRef(Boolean(storedSorters || storedPage.current || storedPage.pageSize));

  const result = useRefineTable<TQueryFnData, TError, TSearchVariables, TData>({
    ...tableProps,
    sorters: { ...tableProps.sorters, initial: storedSorters ?? tableProps.sorters?.initial },
    pagination: { ...tableProps.pagination, ...storedPage },
  });
  const { current, pageSize, sorters, setCurrent, setSorters, tableQuery } = result;

  // L'état d'ouverture n'est pas un geste : l'écrire ferait retenir le lien qu'on vient
  // d'ouvrir. On n'écrit donc qu'un état DIFFÉRENT de celui du montage — comparer plutôt
  // que sauter le premier passage, que React rejoue deux fois en développement.
  const snapshot = JSON.stringify({ sorters, ...(paginated ? { current, pageSize } : {}) });
  const lastSnapshot = useRef<string | null>(null);
  useEffect(() => {
    if (lastSnapshot.current === null) lastSnapshot.current = snapshot;
    if (snapshot === lastSnapshot.current) return;
    lastSnapshot.current = snapshot;
    writeJson(key, JSON.parse(snapshot));
  }, [key, snapshot]);

  const total = tableQuery.data?.total ?? 0;
  useEffect(() => {
    if (!paginated || tableQuery.isFetching) return;
    const next = clampPage(current, pageSize, total);
    if (next !== current) setCurrent(next);
  }, [paginated, tableQuery.isFetching, current, pageSize, total, setCurrent]);

  // Un tri retenu que l'API ne connaît plus (colonne retirée) fait échouer la requête :
  // on l'oublie et on repart du réglage déclaré, une seule fois.
  useEffect(() => {
    if (!tableQuery.isError || !restored.current) return;
    restored.current = false;
    removeKey(key);
    setSorters(tableProps.sorters?.initial ?? []);
    if (paginated) setCurrent(1);
  }, [tableQuery.isError, key, setSorters, setCurrent, paginated, tableProps.sorters?.initial]);

  return result;
}
