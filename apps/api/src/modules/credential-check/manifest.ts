import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const CREDENTIAL_CHECK_MANIFEST: ModuleManifest = {
  id: 'credential-check',
  get name() {
    return msg('analysis.moduleCredentialCheckName');
  },
  get description() {
    return msg('analysis.moduleCredentialCheckDescription');
  },
};
