import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const FIELD_CHECKER_MANIFEST: ModuleManifest = {
  id: 'field-checker',
  get name() {
    return msg('analysis.moduleFieldCheckerName');
  },
  get description() {
    return msg('analysis.moduleFieldCheckerDescription');
  },
};
