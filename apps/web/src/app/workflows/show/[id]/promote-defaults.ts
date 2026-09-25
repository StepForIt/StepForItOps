'use client';

import { useEffect, useState } from 'react';
import { message } from 'antd';
import { apiGet } from '../../../../lib/api';

/** Réponse de `GET /env-switcher/promote/:id/defaults`. */
export interface PromoteDefaults {
  sourceEnv: string | null;
  targetInstanceId: string;
  /** null : source au bout de la chaîne ou env indéterminé — rien n'est présélectionné. */
  targetEnv: string | null;
}

/** La cible que propose l'écran de promotion : même instance, étape suivante de la chaîne. */
export function usePromoteDefaults(workflowId: string | undefined, enabled: boolean): PromoteDefaults | null {
  const [defaults, setDefaults] = useState<PromoteDefaults | null>(null);

  useEffect(() => {
    setDefaults(null);
    if (!enabled || !workflowId) return;
    let cancelled = false;
    apiGet<PromoteDefaults>(`/env-switcher/promote/${workflowId}/defaults`)
      .then((value) => !cancelled && setDefaults(value))
      .catch((error) => message.error((error as Error).message));
    return () => {
      cancelled = true;
    };
  }, [workflowId, enabled]);

  return defaults;
}
