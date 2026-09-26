import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const NOTIFIER_MANIFEST: ModuleManifest = {
  id: 'notifier',
  get name() {
    return msg('ops.moduleNotifierName');
  },
  get description() {
    return msg('ops.moduleNotifierDescription');
  },
};
