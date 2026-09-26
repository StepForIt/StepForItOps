import { ModuleManifest, msg } from '@nwm/core';

/** Nom et description lus à chaque demande : ils suivent la langue de l'appelant. */
export const AI_COST_MANIFEST: ModuleManifest = {
  id: 'ai-cost',
  get name() {
    return msg('ops.moduleAiCostName');
  },
  get description() {
    return msg('ops.moduleAiCostDescription');
  },
};
