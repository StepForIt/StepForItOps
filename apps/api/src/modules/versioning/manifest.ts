import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const VERSIONING_MANIFEST: ModuleManifest = {
  id: 'versioning',
  get name() {
    return msg('platform.moduleVersioningName');
  },
  get description() {
    return msg('platform.moduleVersioningDescription');
  },
};
