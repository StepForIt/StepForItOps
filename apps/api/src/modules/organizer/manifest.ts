import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const ORGANIZER_MANIFEST: ModuleManifest = {
  id: 'organizer',
  get name() {
    return msg('analysis.moduleOrganizerName');
  },
  get description() {
    return msg('analysis.moduleOrganizerDescription');
  },
};
