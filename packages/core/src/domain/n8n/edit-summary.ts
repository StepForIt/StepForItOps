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
      return `renommage du workflow en « ${operation.name} »`;
    case 'rename-node':
      return `renommage de « ${operation.node} » en « ${operation.newName} »`;
    case 'set-node-parameters':
    case 'patch-node-parameters':
      return `paramètres de « ${operation.node} »`;
    case 'remove-node-parameter':
      return `retrait d'un paramètre de « ${operation.node} »`;
    case 'set-node-notes':
      return `note de « ${operation.node} »`;
    case 'set-node-disabled':
      return `${operation.disabled ? 'désactivation' : 'réactivation'} de « ${operation.node} »`;
    case 'remove-node':
      return `suppression de « ${operation.node} »`;
    case 'add-node':
      return `ajout de « ${operation.node?.name ?? 'nœud'} »`;
    case 'connect':
      return `connexion ${operation.from} → ${operation.to}`;
    case 'disconnect':
      return `déconnexion ${operation.from} → ${operation.to}`;
    default:
      return 'modification';
  }
}

/**
 * Une ligne pour tout le brouillon. Au-delà de deux opérations on ne cite que la
 * première et le nombre des autres : un titre qui déroule douze `add-node` n'est
 * plus un titre.
 */
export function summarizeEditOperations(operations: WorkflowEditOperation[]): string {
  const parts = operations.map(describe);
  if (parts.length === 0) return 'Modification proposée';
  const head = parts.length <= 2 ? parts.join(', ') : `${parts[0]} (+${parts.length - 1} autres)`;
  return head.charAt(0).toUpperCase() + head.slice(1);
}
