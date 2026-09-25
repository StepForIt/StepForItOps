'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet } from './api';

/**
 * Quel module porte quelle entrée de menu. Une resource absente de cette table
 * appartient au socle (instances, workflows, findings, modules…) : toujours visible.
 */
const MODULE_BY_RESOURCE: Record<string, string> = {
  versions: 'versioning',
  'export-targets': 'versioning',
  'workflow-groups': 'workflow-groups',
  'resource-mappings': 'env-switcher',
  'release-procedures': 'release-procedures',
  'test-runs': 'tester',
  monitors: 'monitoring',
  'execution-errors': 'monitoring',
  performance: 'performance',
  'ai-cost': 'ai-cost',
  'model-audit': 'model-audit',
  'notification-channels': 'notifier',
  'workflow-map': 'dep-graph',
  resources: 'dep-graph',
  'config-transfer': 'config-transfer',
  'app-logs': 'app-logs',
};

interface ModuleView {
  id: string;
  enabled: boolean;
}

interface EnabledModulesValue {
  /** ids des modules activés ; null tant que l'API n'a pas répondu */
  enabled: string[] | null;
  /** à rappeler après un basculement pour rafraîchir le menu sans recharger la page */
  refresh: () => void;
}

/** Dernier état connu : évite que le menu s'affiche complet puis se réduise au chargement. */
const STORAGE_KEY = 'nwm.enabled-modules';

const EnabledModulesContext = createContext<EnabledModulesValue>({
  enabled: null,
  refresh: () => undefined,
});

export function EnabledModulesProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState<string[] | null>(null);

  const load = useCallback(() => {
    apiGet<ModuleView[]>('/modules?_start=0&_end=200')
      .then((rows) => {
        const ids = rows.filter((row) => row.enabled).map((row) => row.id);
        setEnabled(ids);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      })
      .catch(() => setEnabled((current) => current ?? []));
  }, []);

  useEffect(() => {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        setEnabled(JSON.parse(cached) as string[]);
      } catch {
        // cache illisible : on attend simplement la réponse de l'API
      }
    }
    load();
  }, [load]);

  const value = useMemo<EnabledModulesValue>(() => ({ enabled, refresh: load }), [enabled, load]);

  return <EnabledModulesContext.Provider value={value}>{children}</EnabledModulesContext.Provider>;
}

export const useEnabledModules = (): EnabledModulesValue => useContext(EnabledModulesContext);

/**
 * Masque du menu les resources dont le module est désactivé ou supprimé. La resource reste
 * déclarée (routes existantes, l'API répond 403) ; liste inconnue (`null`) = rien de masqué.
 */
export function hideDisabledResources<T extends { name: string; meta?: Record<string, unknown> }>(
  resources: T[],
  enabled: string[] | null,
): T[] {
  if (!enabled) return resources;
  return resources.map((resource) => {
    const moduleId = MODULE_BY_RESOURCE[resource.name];
    if (!moduleId || enabled.includes(moduleId)) return resource;
    return { ...resource, meta: { ...resource.meta, hide: true } };
  });
}
