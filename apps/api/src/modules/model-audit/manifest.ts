import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const MODEL_AUDIT_MANIFEST: ModuleManifest = {
  id: 'model-audit',
  get name() {
    return msg('analysis.moduleModelAuditName');
  },
  get description() {
    return msg('analysis.moduleModelAuditDescription');
  },
};
