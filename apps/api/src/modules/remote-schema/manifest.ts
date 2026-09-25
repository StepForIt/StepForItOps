import { ModuleManifest } from '@nwm/core';
import { REMOTE_SCHEMA_MODULE_ID } from '../../infra/remote-schema/remote-schema-check.service';

export const REMOTE_SCHEMA_MANIFEST: ModuleManifest = {
  id: REMOTE_SCHEMA_MODULE_ID,
  name: 'Tables distantes',
  description: 'Colonnes des tables distantes attendues par les workflows',
};
