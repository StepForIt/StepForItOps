/** État d'un workflow vis-à-vis de n8n, tel que la synchro l'a constaté. */
export interface RetirableWorkflow {
  archivedUpstream: boolean;
  missingUpstreamAt: Date | null;
}

/**
 * Le workflow n'est plus une pièce vivante de l'instance : n8n l'a archivé, ou
 * ne le connaît plus. Son export part alors dans `archived/`.
 *
 * On ne regarde QUE ce que n8n dit — pas le tag `archived` ni le préfixe
 * `[ARCHIVED]` posés par la plateforme : ceux-là sont une convention de
 * rangement de l'app, réversible d'un clic, quand l'archivage natif de n8n
 * interdit toute écriture et retire le workflow de l'exécution.
 */
export function isRetiredFromN8n(workflow: RetirableWorkflow): boolean {
  return workflow.archivedUpstream || workflow.missingUpstreamAt !== null;
}
