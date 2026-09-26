import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const PERFORMANCE_MANIFEST: ModuleManifest = {
  id: 'performance',
  get name() {
    return msg('ops.modulePerformanceName');
  },
  get description() {
    return msg('ops.modulePerformanceDescription');
  },
};
