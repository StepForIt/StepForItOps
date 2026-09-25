/**
 * Plan d'un geste d'environnement appliqué à plusieurs workflows métier d'un coup :
 * pour chaque famille, QUEL exemplaire part et OÙ il va — ou pourquoi elle reste
 * de côté. Le lot se décrit une seule fois (« de DEV vers PROD ») et chaque famille
 * s'y résout ; une famille qui ne s'y prête pas est annoncée et ignorée, jamais
 * mise en échec : un lot normal passerait sinon pour un lot cassé.
 *
 * Pure : ni preview, ni gate — elle dit seulement qui fait quoi.
 */

export type BulkEnvAction = 'promote' | 'duplicate' | 'mark';

export interface BulkExemplar {
  id: string;
  name: string;
  env: string | null;
  instanceId: string;
  /** Archivé par la plateforme (tag, préfixe). */
  archived: boolean;
  archivedUpstream: boolean;
  /** Supprimé dans n8n. */
  missing: boolean;
}

export interface BulkFamily {
  key: string;
  name: string;
  members: BulkExemplar[];
}

export interface BulkEnvRequest {
  action: BulkEnvAction;
  /** Env de départ ; `null` pour « déclarer l'env » : on part des exemplaires qui n'en ont pas. */
  sourceEnv: string | null;
  targetEnv: string;
  /** Instance d'arrivée d'une promotion quand l'env cible n'existe nulle part dans la famille. */
  fallbackInstanceId?: string;
}

interface BulkPlanBase {
  familyKey: string;
  familyName: string;
}

export interface BulkPlannedRow extends BulkPlanBase {
  status: 'planned';
  sourceId: string;
  sourceName: string;
  sourceInstanceId: string;
  targetEnv: string;
  targetInstanceId: string;
  /** L'exemplaire de l'env cible déjà connu, quand il existe. */
  targetExemplarId?: string;
}

/**
 * Pourquoi une famille est écartée. `already-done` n'est pas un refus : le geste a
 * déjà eu lieu, et un rejeu de procédure le passe au lieu de s'y arrêter.
 */
export type BulkSkipCode = 'already-done' | 'missing' | 'ambiguous' | 'conflict';

export interface BulkSkippedRow extends BulkPlanBase {
  status: 'skipped';
  code: BulkSkipCode;
  reason: string;
  /** Pour `already-done` : l'exemplaire qui porte déjà le résultat du geste. */
  exemplarId?: string;
}

export type BulkPlanRow = BulkPlannedRow | BulkSkippedRow;

const label = (env: string | null): string => (env ? env.toUpperCase() : 'sans env');

/** Un archivé ou un absent de n8n ne part nulle part : on n'y écrit plus. */
const usable = (member: BulkExemplar): boolean =>
  !member.archived && !member.archivedUpstream && !member.missing;

export function planBulkEnvAction(families: BulkFamily[], request: BulkEnvRequest): BulkPlanRow[] {
  if (request.sourceEnv === request.targetEnv) {
    throw new Error("Env source et env cible identiques : il n'y a rien à faire.");
  }
  return families.map((family) => planFamily(family, request));
}

function planFamily(family: BulkFamily, request: BulkEnvRequest): BulkPlanRow {
  const base = { familyKey: family.key, familyName: family.name };
  const skip = (code: BulkSkipCode, reason: string, exemplarId?: string): BulkSkippedRow => ({
    ...base,
    status: 'skipped',
    code,
    reason,
    ...(exemplarId ? { exemplarId } : {}),
  });

  const inTarget = family.members.filter((member) => member.env === request.targetEnv);
  const sources = family.members.filter((member) => member.env === request.sourceEnv && usable(member));
  if (sources.length === 0) {
    const declared = inTarget.filter(usable);
    if (request.action === 'mark' && declared.length === 1) {
      return skip('already-done', `déjà déclaré ${label(request.targetEnv)}`, declared[0].id);
    }
    return skip(
      'missing',
      request.action === 'mark'
        ? 'aucun exemplaire sans env à déclarer'
        : `aucun exemplaire ${label(request.sourceEnv)} utilisable (absent, archivé ou supprimé dans n8n)`,
    );
  }
  if (sources.length > 1) {
    return skip(
      'ambiguous',
      `plusieurs exemplaires ${label(request.sourceEnv)} — lequel part est à choisir sur sa page`,
    );
  }
  const source = sources[0];
  const planned = (targetInstanceId: string, targetExemplarId?: string): BulkPlannedRow => ({
    ...base,
    status: 'planned',
    sourceId: source.id,
    sourceName: source.name,
    sourceInstanceId: source.instanceId,
    targetEnv: request.targetEnv,
    targetInstanceId,
    targetExemplarId,
  });

  switch (request.action) {
    case 'mark':
      // Deux exemplaires déclarés du même env se disputeraient l'appariement par nom.
      if (inTarget.length > 0) {
        return skip('conflict', `la famille a déjà son exemplaire ${label(request.targetEnv)}`);
      }
      return planned(source.instanceId);
    case 'duplicate': {
      const sameInstance = inTarget.find((member) => member.instanceId === source.instanceId);
      if (sameInstance) {
        return skip(
          'already-done',
          `une copie ${label(request.targetEnv)} existe déjà sur cette instance`,
          sameInstance.id,
        );
      }
      return planned(source.instanceId);
    }
    case 'promote': {
      if (inTarget.length > 1) {
        return skip(
          'ambiguous',
          `plusieurs exemplaires ${label(request.targetEnv)} — la cible est à choisir sur sa page`,
        );
      }
      const target = inTarget[0];
      if (target) return planned(target.instanceId, target.id);
      return planned(request.fallbackInstanceId ?? source.instanceId);
    }
  }
}
