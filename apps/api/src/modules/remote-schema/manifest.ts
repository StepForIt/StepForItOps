import { ModuleManifest, msg } from '@nwm/core';
import { REMOTE_SCHEMA_MODULE_ID } from '../../infra/remote-schema/remote-schema-check.service';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const REMOTE_SCHEMA_MANIFEST: ModuleManifest = {
  id: REMOTE_SCHEMA_MODULE_ID,
  get name() {
    return msg('analysis.moduleRemoteSchemaName');
  },
  get description() {
    return msg('analysis.moduleRemoteSchemaDescription');
  },
};
