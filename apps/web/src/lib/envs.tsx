'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet } from './api';

/**
 * Les environnements DÉCLARÉS, servis une fois pour toute la console : leur ordre,
 * leur libellé et leur couleur. Rien n'est plus figé à dev/preprod/prod — chaque
 * écran qui offre un choix d'env lit cette liste.
 */
export interface EnvDefinition {
  id: string;
  label: string;
  color: string;
  monitored: boolean;
  canonicalWebhookPath: boolean;
  /** L'env dont celui-ci dépend ; null pour la racine. */
  after: string | null;
}

export interface PlatformSettings {
  includeArchived: boolean;
  includeMissing: boolean;
  envs: EnvDefinition[];
  envChain: string[];
  envChainMode: 'warn' | 'block';
}

/** Ce qu'on affiche tant que l'API n'a pas répondu — et ce qu'une installation neuve déclare. */
export const FALLBACK_ENVS: EnvDefinition[] = [
  { id: 'dev', label: 'DEV', color: 'green', monitored: false, canonicalWebhookPath: false, after: null },
  {
    id: 'preprod',
    label: 'PREPROD',
    color: 'orange',
    monitored: false,
    canonicalWebhookPath: false,
    after: 'dev',
  },
  { id: 'prod', label: 'PROD', color: 'red', monitored: true, canonicalWebhookPath: true, after: 'preprod' },
];

/** Dernier état connu : évite qu'un tag d'env clignote de la couleur par défaut à la sienne. */
const STORAGE_KEY = 'nwm.envs';

interface EnvsValue {
  envs: EnvDefinition[];
  /** À rappeler après édition des réglages, pour que toute la console suive. */
  refresh: () => void;
}

const EnvsContext = createContext<EnvsValue>({ envs: FALLBACK_ENVS, refresh: () => undefined });

export function EnvsProvider({ children }: { children: React.ReactNode }) {
  const [envs, setEnvs] = useState<EnvDefinition[]>(FALLBACK_ENVS);

  const load = useCallback(() => {
    apiGet<PlatformSettings>('/settings/platform')
      .then((settings) => {
        if (!settings.envs?.length) return;
        setEnvs(settings.envs);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.envs));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        setEnvs(JSON.parse(cached) as EnvDefinition[]);
      } catch {
        // cache illisible : on attend la réponse de l'API
      }
    }
    load();
  }, [load]);

  const value = useMemo<EnvsValue>(() => ({ envs, refresh: load }), [envs, load]);
  return <EnvsContext.Provider value={value}>{children}</EnvsContext.Provider>;
}

export const useEnvs = (): EnvsValue => useContext(EnvsContext);

/** Les ids seuls, dans l'ordre déclaré — ce qu'attendent les listes déroulantes. */
export function useEnvIds(): string[] {
  return useEnvs().envs.map((env) => env.id);
}

/** Options `{ value, label }` pour un Select antd. */
export function useEnvOptions(): Array<{ value: string; label: string }> {
  return useEnvs().envs.map((env) => ({ value: env.id, label: env.label }));
}

/**
 * Couleur d'un env, y compris d'un env que plus personne ne déclare : un workflow
 * peut porter le suffixe d'un env supprimé, et il vaut mieux un tag neutre qu'aucun.
 */
export function useEnvColor(): (env: string | null | undefined) => string {
  const { envs } = useEnvs();
  return (env) => envs.find((item) => item.id === env)?.color ?? 'default';
}

export function useEnvLabel(): (env: string | null | undefined) => string {
  const { envs } = useEnvs();
  return (env) => (env ? (envs.find((item) => item.id === env)?.label ?? env.toUpperCase()) : '');
}
