import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const TESTER_MANIFEST: ModuleManifest = {
  id: 'tester',
  get name() {
    return msg('platform.moduleTesterName');
  },
  get description() {
    return msg('platform.moduleTesterDescription');
  },
};
