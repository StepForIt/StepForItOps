import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const MONITORING_MANIFEST: ModuleManifest = {
  id: 'monitoring',
  get name() {
    return msg('ops.moduleMonitoringName');
  },
  get description() {
    return msg('ops.moduleMonitoringDescription');
  },
};
