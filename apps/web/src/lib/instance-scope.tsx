'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Spin } from 'antd';
import { apiGet } from './api';

export interface InstanceOption {
  id: string;
  name: string;
}

interface InstanceScopeValue {
  /** null = toutes les instances */
  scope: string | null;
  /** false tant que le scope mémorisé n'a pas été relu : aucune liste ne doit charger avant. */
  ready: boolean;
  setScope: (id: string | null) => void;
  instances: InstanceOption[];
  instanceName: (id?: string | null) => string;
}

const STORAGE_KEY = 'nwm.instance-scope';

const InstanceScopeContext = createContext<InstanceScopeValue>({
  scope: null,
  ready: false,
  setScope: () => undefined,
  instances: [],
  instanceName: () => '—',
});

/** Scope d'instance global (persisté en localStorage) appliqué à toutes les listes de l'UI. */
export function InstanceScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScopeState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [instances, setInstances] = useState<InstanceOption[]>([]);

  useEffect(() => {
    setScopeState(window.localStorage.getItem(STORAGE_KEY) || null);
    setReady(true);
    apiGet<InstanceOption[]>('/instances?_start=0&_end=100')
      .then((rows) => setInstances(rows.map(({ id, name }) => ({ id, name }))))
      .catch(() => setInstances([]));
  }, []);

  const value = useMemo<InstanceScopeValue>(
    () => ({
      scope,
      ready,
      setScope: (id) => {
        setScopeState(id);
        if (id) window.localStorage.setItem(STORAGE_KEY, id);
        else window.localStorage.removeItem(STORAGE_KEY);
      },
      instances,
      instanceName: (id) => {
        if (!id) return '—';
        return instances.find((instance) => instance.id === id)?.name ?? `${id.slice(0, 8)}…`;
      },
    }),
    [scope, ready, instances],
  );

  return <InstanceScopeContext.Provider value={value}>{children}</InstanceScopeContext.Provider>;
}

export const useInstanceScope = (): InstanceScopeValue => useContext(InstanceScopeContext);

/**
 * Retient le contenu d'une page tant que le scope mémorisé n'est pas relu. Sinon la page se
 * monte avec `scope = null` et lance un premier chargement toutes instances confondues, qui
 * peut répondre après la requête filtrée et réafficher les autres instances.
 */
export function InstanceScopeGate({ children }: { children: React.ReactNode }) {
  const { ready } = useInstanceScope();
  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }
  return <>{children}</>;
}
