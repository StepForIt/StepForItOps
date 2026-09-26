import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const DASHBOARD_MANIFEST: ModuleManifest = {
  id: 'dashboard',
  get name() {
    return msg('ops.moduleDashboardName');
  },
  get description() {
    return msg('ops.moduleDashboardDescription');
  },
};
