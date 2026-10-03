import { ModuleManifest, msg } from '@nwm/core';

/** Libellés en accesseurs : lus à chaque requête, donc dans la langue de l'appelant. */
export const IMPACT_STUDY_MANIFEST: ModuleManifest = {
  id: 'impact-study',
  get name() {
    return msg('impact.manifestName');
  },
  get description() {
    return msg('impact.manifestDescription');
  },
};
