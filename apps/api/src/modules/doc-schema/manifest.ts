import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const DOC_SCHEMA_MANIFEST: ModuleManifest = {
  id: 'doc-schema',
  get name() {
    return msg('analysis.moduleDocSchemaName');
  },
  get description() {
    return msg('analysis.moduleDocSchemaDescription');
  },
};
