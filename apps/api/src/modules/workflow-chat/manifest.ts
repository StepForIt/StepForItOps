import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const WORKFLOW_CHAT_MANIFEST: ModuleManifest = {
  id: 'workflow-chat',
  get name() {
    return msg('chat.manifestName');
  },
  get description() {
    return msg('chat.manifestDescription');
  },
};
