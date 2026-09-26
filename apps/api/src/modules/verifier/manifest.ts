import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const VERIFIER_MANIFEST: ModuleManifest = {
  id: 'verifier',
  get name() {
    return msg('analysis.moduleVerifierName');
  },
  get description() {
    return msg('analysis.moduleVerifierDescription');
  },
};
