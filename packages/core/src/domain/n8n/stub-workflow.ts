/**
 * Workflow bouchon : un sous-workflow de remplacement qui ENREGISTRE l'appel
 * au lieu de l'exécuter. Pendant un test, l'appelant part bien chercher un
 * sous-workflow — on voit donc ce qui serait parti, dans son exécution n8n —
 * mais rien n'est envoyé pour de vrai.
 *
 * L'alternative (épingler le nœud d'appel) ne fait partir aucun appel du tout :
 * plus sûr, mais on ne voit pas ce qu'on aurait envoyé. Les deux sont utiles.
 */
import { msg } from '../../i18n';
import { N8nWorkflow } from './workflow.types';

export const STUB_PREFIX = '[BOUCHON]';
/**
 * Tag posé sur le bouchon : c'est lui qui le sort des listes et des analyses.
 * Le préfixe compte aussi, contrairement à la copie `[TEST]` — la plateforme
 * retrouve DÉJÀ un bouchon existant par son nom pour le réutiliser, un
 * workflow qui s'appelle « [BOUCHON] X » est donc un bouchon par contrat.
 */
export const STUB_TAG = 'n8n-ops:bouchon';

/** Nom du bouchon d'un sous-workflow donné — c'est lui qui sert de clé de réutilisation. */
export function stubWorkflowName(subWorkflowName: string): string {
  return `${STUB_PREFIX} ${subWorkflowName}`;
}

/**
 * Trigger de sous-workflow → nœud Set qui renvoie l'entrée telle quelle, marquée.
 * L'appelant continue son chemin avec des données de forme plausible, et le
 * marqueur évite qu'un résultat de test soit pris pour un vrai.
 */
export function buildStubWorkflow(subWorkflowName: string): N8nWorkflow {
  const triggerName = msg('platform.stubTriggerNode');
  const echoName = msg('platform.stubEchoNode');
  return {
    name: stubWorkflowName(subWorkflowName),
    active: false,
    nodes: [
      {
        name: triggerName,
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
        notes: msg('platform.stubNotes', { subWorkflowName }),
        notesInFlow: true,
      },
      {
        name: echoName,
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [220, 0],
        parameters: {
          mode: 'raw',
          jsonOutput: '={{ { ...$json, __bouchon: true } }}',
          options: {},
        },
      },
    ],
    connections: {
      [triggerName]: { main: [[{ node: echoName, type: 'main', index: 0 }]] },
    },
    settings: {},
  } as N8nWorkflow;
}

/** Un bouchon se reconnaît à son tag ou, à défaut, au préfixe de son nom. */
export function isStubWorkflow(name: string, tags: string[]): boolean {
  return tags.includes(STUB_TAG) || name.startsWith(STUB_PREFIX);
}
