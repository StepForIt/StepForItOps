import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const DEP_GRAPH_MANIFEST: ModuleManifest = {
  id: 'dep-graph',
  get name() {
    return msg('platform.moduleDepGraphName');
  },
  get description() {
    return msg('platform.moduleDepGraphDescription');
  },
};
