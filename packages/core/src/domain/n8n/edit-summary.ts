import { msg } from '../../i18n';
import { WorkflowEditOperation } from './workflow-edit';

/**
 * Résumé d'une liste d'opérations d'édition, en une ligne.
 *
 * Sert quand l'assistant n'a PAS fourni le sien : le brouillon qu'il a soumis à
 * `check_workflow` est repris tel quel, et une proposition sans titre s'affiche
 * partout — fil, revue, liste des conversations — comme « Modification proposée »,
 * ce qui ne dit pas sur quel nœud elle porte.
 */

/** Ce que fait une opération, du point de vue de celui qui relit le diff. */
function describe(operation: WorkflowEditOperation): string {
  switch (operation.op) {
    case 'set-workflow-name':
      return msg('edit.summaryRenameWorkflow', { name: operation.name });
    case 'rename-node':
      return msg('edit.summaryRenameNode', { node: operation.node, newName: operation.newName });
    case 'set-node-parameters':
    case 'patch-node-parameters':
      return msg('edit.summaryParameters', { node: operation.node });
    case 'remove-node-parameter':
      return msg('edit.summaryRemoveParameter', { node: operation.node });
    case 'set-node-notes':
      return msg('edit.summaryNotes', { node: operation.node });
    case 'set-node-disabled':
      return msg('edit.summaryDisabled', { disabled: operation.disabled, node: operation.node });
    case 'remove-node':
      return msg('edit.summaryRemoveNode', { node: operation.node });
    case 'add-node':
      return msg('edit.summaryAddNode', { name: operation.node?.name ?? msg('edit.summaryNodeFallback') });
    case 'connect':
      return msg('edit.summaryConnect', { from: operation.from, to: operation.to });
    case 'disconnect':
      return msg('edit.summaryDisconnect', { from: operation.from, to: operation.to });
    default:
      return msg('edit.summaryModification');
  }
}

/**
 * Une ligne pour tout le brouillon. Au-delà de deux opérations on ne cite que la
 * première et le nombre des autres : un titre qui déroule douze `add-node` n'est
 * plus un titre.
 */
export function summarizeEditOperations(operations: WorkflowEditOperation[]): string {
  const parts = operations.map(describe);
  if (parts.length === 0) return msg('edit.summaryDefault');
  const head =
    parts.length <= 2
      ? parts.join(', ')
      : msg('edit.summaryMore', { head: parts[0], count: parts.length - 1 });
  return head.charAt(0).toUpperCase() + head.slice(1);
}
