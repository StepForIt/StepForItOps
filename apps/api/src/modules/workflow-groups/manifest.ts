import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const WORKFLOW_GROUPS_MANIFEST: ModuleManifest = {
  id: 'workflow-groups',
  get name() {
    return msg('platform.moduleWorkflowGroupsName');
  },
  get description() {
    return msg('platform.moduleWorkflowGroupsDescription');
  },
};
