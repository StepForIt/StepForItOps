import { PROD_ENV_ID } from './env';

/**
 * Où en est un exemplaire par rapport à la prod du même workflow métier :
 * - `in-sync` : même contenu que la prod (au sens de ce qu'une promotion transporte) ;
 * - `ahead` : différent, et modifié APRÈS la prod — il y a quelque chose à déployer ;
 * - `behind` : différent, mais c'est la prod qui a bougé en dernier — un correctif fait
 *   là-bas, que la prochaine promotion écraserait ;
 * - `not-deployed` : aucun exemplaire en prod ;
 * - `unknown` : contenu non comparable (plateforme sans empreinte).
 */
export type EnvDivergenceStatus = 'in-sync' | 'ahead' | 'behind' | 'not-deployed' | 'unknown';

export interface EnvDivergenceMember {
  id: string;
  env: string | null;
  /** Empreinte de déploiement (`deployKey`), null quand elle n'est pas calculable. */
  key: string | null;
  /** Dernière modification chez la plateforme d'origine. */
  updatedAt: Date | null;
}

export interface EnvDivergence {
  status: EnvDivergenceStatus;
  referenceEnv: string;
  /** Exemplaires de référence auxquels on a comparé. */
  referenceIds: string[];
}

/** Ce qu'il reste à pousser vers la prod : un contenu plus récent, ou jamais déployé. */
export function isToDeploy(status: EnvDivergenceStatus): boolean {
  return status === 'ahead' || status === 'not-deployed';
}

/**
 * Filtre de liste : un id d'env = ses exemplaires à déployer ; `behind` = la prod a
 * bougé après eux ; `diverged` = différent de la prod, dans un sens ou dans l'autre.
 */
export function matchesDivergenceFilter(
  filter: string,
  env: string | null,
  divergence: EnvDivergence | null | undefined,
): boolean {
  if (!divergence) return false;
  if (filter === 'behind') return divergence.status === 'behind';
  if (filter === 'diverged') return divergence.status === 'ahead' || divergence.status === 'behind';
  return env === filter && isToDeploy(divergence.status);
}

/**
 * Compare chaque exemplaire d'une famille à son (ou ses) exemplaire(s) de référence.
 * Les exemplaires de la référence elle-même et ceux dont l'env est inconnu n'ont pas
 * de statut : il n'y a rien à quoi les comparer qui ait un sens.
 *
 * Plusieurs prods (deux instances) : l'exemplaire n'est à jour que s'il égale CHACUNE,
 * puisqu'une promotion vers celle qui diffère changerait quelque chose.
 *
 * Le sens (`ahead` / `behind`) vient des dates de modification, faute de mieux : le
 * contenu dit qu'ils diffèrent, pas lequel a raison.
 */
export function envDivergence(
  members: readonly EnvDivergenceMember[],
  referenceEnv: string = PROD_ENV_ID,
): Map<string, EnvDivergence> {
  const references = members.filter((member) => member.env === referenceEnv);
  const referenceIds = references.map((member) => member.id);
  const result = new Map<string, EnvDivergence>();
  for (const member of members) {
    if (!member.env || member.env === referenceEnv) continue;
    result.set(member.id, { status: statusOf(member, references), referenceEnv, referenceIds });
  }
  return result;
}

function statusOf(
  member: EnvDivergenceMember,
  references: readonly EnvDivergenceMember[],
): EnvDivergenceStatus {
  if (references.length === 0) return 'not-deployed';
  if (member.key === null || references.some((reference) => reference.key === null)) return 'unknown';
  const differing = references.filter((reference) => reference.key !== member.key);
  if (differing.length === 0) return 'in-sync';
  const latest = Math.max(...differing.map((reference) => reference.updatedAt?.getTime() ?? 0));
  const own = member.updatedAt?.getTime();
  return own === undefined || own >= latest ? 'ahead' : 'behind';
}
