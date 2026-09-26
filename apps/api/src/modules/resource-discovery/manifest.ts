import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const RESOURCE_DISCOVERY_MANIFEST: ModuleManifest = {
  id: 'resource-discovery',
  get name() {
    return msg('platform.moduleResourceDiscoveryName');
  },
  get description() {
    return msg('platform.moduleResourceDiscoveryDescription');
  },
};
