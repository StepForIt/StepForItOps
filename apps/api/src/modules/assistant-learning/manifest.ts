import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const ASSISTANT_LEARNING_MANIFEST: ModuleManifest = {
  id: 'assistant-learning',
  get name() {
    return msg('learning.moduleName');
  },
  get description() {
    return msg('learning.moduleDescription');
  },
};
