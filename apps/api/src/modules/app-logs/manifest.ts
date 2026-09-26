import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const APP_LOGS_MANIFEST: ModuleManifest = {
  id: 'app-logs',
  get name() {
    return msg('ops.moduleAppLogsName');
  },
  get description() {
    return msg('ops.moduleAppLogsDescription');
  },
};
