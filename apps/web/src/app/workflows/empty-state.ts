/**
 * Liste de workflows vide sans recherche ni filtre (cas `idle` de `listEmptyKind`) :
 * soit rien n'a encore été importé — on propose la synchro —, soit tout ce qui existe
 * est archivé, et la liste les masque par défaut. Dire « importez vos workflows » à
 * qui les a tous rangés ferait croire qu'ils ont disparu.
 */
export type WorkflowsIdleKind = 'all-archived' | 'not-synced';

export function workflowsIdleKind(archivedCount: number): WorkflowsIdleKind {
  return archivedCount > 0 ? 'all-archived' : 'not-synced';
}
