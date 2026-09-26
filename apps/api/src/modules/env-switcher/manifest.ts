import { ModuleManifest, msg } from '@nwm/core';

/** Libellés en accesseurs : lus à chaque requête, donc dans la langue de l'appelant. */
export const ENV_SWITCHER_MANIFEST: ModuleManifest = {
  id: 'env-switcher',
  get name() {
    return msg('env.manifestName');
  },
  get description() {
    return msg('env.manifestDescription');
  },
};
