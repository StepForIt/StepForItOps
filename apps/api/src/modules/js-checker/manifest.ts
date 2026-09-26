import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const JS_CHECKER_MANIFEST: ModuleManifest = {
  id: 'js-checker',
  get name() {
    return msg('analysis.moduleJsCheckerName');
  },
  get description() {
    return msg('analysis.moduleJsCheckerDescription');
  },
};
