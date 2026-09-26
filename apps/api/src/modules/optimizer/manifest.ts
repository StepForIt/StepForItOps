import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const OPTIMIZER_MANIFEST: ModuleManifest = {
  id: 'optimizer',
  get name() {
    return msg('analysis.moduleOptimizerName');
  },
  get description() {
    return msg('analysis.moduleOptimizerDescription');
  },
};
