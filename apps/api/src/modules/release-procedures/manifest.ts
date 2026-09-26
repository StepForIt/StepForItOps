import { ModuleManifest, msg } from '@nwm/core';

/** Libellés en accesseurs : lus à chaque requête, donc dans la langue de l'appelant. */
export const RELEASE_PROCEDURES_MANIFEST: ModuleManifest = {
  id: 'release-procedures',
  get name() {
    return msg('release.manifestName');
  },
  get description() {
    return msg('release.manifestDescription');
  },
};
