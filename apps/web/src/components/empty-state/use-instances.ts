'use client';

import { useList } from '@refinedev/core';

export interface InstanceRow {
  id: string;
  name: string;
}

/**
 * Instances relues à l'affichage d'un état vide, plutôt que prises au contexte de
 * scope chargé une fois au démarrage : l'instance créée à l'instant ne serait sinon
 * pas vue en revenant sur la page, qui redemanderait d'en ajouter une. La requête est
 * partagée (même clé Refine) par l'état vide et le bouton de synchro.
 */
export function useInstances(enabled = true) {
  const { data, isLoading } = useList<InstanceRow>({
    resource: 'instances',
    pagination: { pageSize: 100 },
    queryOptions: { enabled },
  });
  return { instances: data?.data ?? [], loading: enabled && isLoading };
}
