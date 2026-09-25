import { PlatformExecution } from '../../ports/workflow-platform.port';

/**
 * Les statuts numériques des logs Make : `1` succès, `2` avertissement,
 * `3` erreur (documenté sur les logs d'exécutions incomplètes).
 *
 * `2` est rabattu sur `error` et non sur `success` : un avertissement Make
 * signifie qu'au moins un module a échoué pendant que le scénario allait au
 * bout. C'est exactement ce qu'un module de surveillance doit remonter — le
 * ranger dans les succès reviendrait à se taire sur des erreurs réelles.
 *
 * Tout code inconnu vaut `error`, par la même règle que côté n8n : se taire sur
 * une exécution qu'on n'a pas su lire est le seul travers vraiment coûteux.
 */
export function toExecutionStatus(status: number | undefined): PlatformExecution['status'] {
  if (status === 1) return 'success';
  return 'error';
}

/** `GET /scenarios/{id}/executions/{executionId}` répond en toutes lettres. */
export function toExecutionStatusFromLabel(label: string | undefined): PlatformExecution['status'] {
  switch (label) {
    case 'SUCCESS':
      return 'success';
    case 'RUNNING':
      return 'running';
    case 'WARNING':
    case 'ERROR':
      return 'error';
    default:
      return 'error';
  }
}
