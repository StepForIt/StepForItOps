import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const CONFIG_TRANSFER_MANIFEST: ModuleManifest = {
  id: 'config-transfer',
  get name() {
    return msg('platform.moduleConfigTransferName');
  },
  get description() {
    return msg('platform.moduleConfigTransferDescription');
  },
};
