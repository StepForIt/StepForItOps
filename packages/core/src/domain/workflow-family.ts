import { DEFAULT_ENV_IDS } from './env';
import { withoutArchivedPrefix } from './workflow-archive';
import { detectWorkflowEnv, withoutEnvSuffix } from './workflow-env';
import { withoutVersionMarker } from './workflow-version-name';

/**
 * Nom « métier » d'un workflow : ce qui reste une fois retirés le préfixe
 * d'archivage, le suffixe d'environnement et le numéro de version — « Facturation
 * (1.2.1) - DEV » et « [ARCHIVED] Facturation (1.1.4) (prod) » désignent le même
 * workflow.
 *
 * Le numéro en fait partie parce qu'il BOUGE : le garder dans la clé faisait d'une
 * montée de version un changement d'identité — historique de versions perdu, frères
 * introuvables, et une promotion qui crée un second exemplaire à côté de la prod
 * vivante au lieu de l'écraser.
 */
export function workflowFamilyName(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  const withoutPrefix = withoutArchivedPrefix(name).trim();
  const withoutEnv = withoutEnvSuffix(withoutPrefix, envs) || withoutPrefix;
  return withoutVersionMarker(withoutEnv);
}

/** Clé de regroupement : nom métier insensible à la casse et aux espaces multiples. */
export function workflowFamilyKey(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  return workflowFamilyName(name, envs).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Clé d'appariement d'un exemplaire précis : le nom métier ET son env. C'est ce
 * qui reconnaît « X (1.2.1) - DEV » dans « X (1.1.4) - PROD » sans confondre deux
 * exemplaires qui cohabitent sur la même instance.
 *
 * L'env est lu du seul NOM : les tags disent l'env de l'exemplaire qu'on a en
 * main, pas celui du nom qu'on cherche sur la cible.
 */
export function envFamilyKey(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string {
  return `${workflowFamilyKey(name, envs)}|${detectWorkflowEnv(name, [], envs) ?? ''}`;
}
