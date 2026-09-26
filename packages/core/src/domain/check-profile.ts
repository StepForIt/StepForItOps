/**
 * Profils de contrôles : quelle sélection s'applique à un workflow, et à quel
 * périmètre on enregistre une sélection modifiée.
 *
 * Deux décisions tiennent tout le reste :
 *
 * 1. On enregistre ce qui est DÉCOCHÉ, jamais ce qui est gardé. Une règle
 *    ajoutée plus tard est donc active partout, sans avoir à rouvrir les profils
 *    enregistrés — l'inverse aurait figé chaque profil au catalogue de son jour.
 * 2. Le périmètre le plus précis GAGNE, il ne se fusionne pas. Fusionner
 *    obligerait à lire quatre profils pour savoir ce qui va tourner ; ici la
 *    réponse est « celui-ci », et l'UI peut le nommer.
 */

import { normalizeDisabled } from './check-catalog';
import { msg } from '../i18n/translate';

/** Du plus précis au plus large. La famille couvre le workflow dans tous ses envs. */
export type CheckScope = 'family' | 'group' | 'instance' | 'global';

export const CHECK_SCOPES: CheckScope[] = ['family', 'group', 'instance', 'global'];

/** Libellé d'un périmètre, dans la langue courante. */
export function checkScopeLabel(scope: CheckScope): string {
  return msg('checks.scopeLabel', { scope });
}

export interface CheckProfileLike {
  scope: CheckScope;
  /** instanceId, groupId, ou workflow d'ancrage de la famille ; '' pour global. */
  targetId: string;
  disabled: string[];
  updatedAt?: Date | string;
}

export interface ResolvedCheckProfile {
  disabled: string[];
  /** Profil retenu, ou null quand rien n'est enregistré (tout est actif). */
  source: CheckProfileLike | null;
}

function rank(scope: CheckScope): number {
  return CHECK_SCOPES.indexOf(scope);
}

function updatedAtMs(profile: CheckProfileLike): number {
  return profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0;
}

/**
 * Sélection effective, parmi les profils DÉJÀ filtrés sur ce workflow (sa
 * famille, ses groupes, son instance, le global). Un workflow pouvant être dans
 * plusieurs groupes, le plus récemment modifié tranche : à égalité de précision
 * il n'y a pas de gagnant naturel, autant prendre le dernier geste de l'humain.
 */
export function resolveCheckProfile(applicable: readonly CheckProfileLike[]): ResolvedCheckProfile {
  const sorted = [...applicable].sort(
    (a, b) => rank(a.scope) - rank(b.scope) || updatedAtMs(b) - updatedAtMs(a),
  );
  const source = sorted[0] ?? null;
  return { disabled: source ? normalizeDisabled(source.disabled) : [], source };
}

/** Deux sélections sont-elles la même ? (comparaison après normalisation) */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizeDisabled(a);
  const right = normalizeDisabled(b);
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

export interface SaveDecisionInput {
  /** Sélection que l'utilisateur vient de composer. */
  selection: readonly string[];
  /** Ce qui s'appliquait avant (résolution), ou null si rien n'est enregistré. */
  resolved: ResolvedCheckProfile;
  /** Un profil existe-t-il quelque part dans la plateforme ? */
  hasAnyProfile: boolean;
  /**
   * Nombre d'AUTRES familles portant déjà exactement cette sélection, par
   * périmètre. C'est le signal de répétition : à partir d'une, la sélection
   * n'est plus une exception de ce workflow.
   */
  twinFamilies: { group: number; instance: number; anywhere: number };
  /** Groupes du workflow (vide s'il n'en a pas) : sans groupe, pas de palier groupe. */
  hasGroup: boolean;
}

export type SaveDecision =
  /** Rien à enregistrer : la sélection est déjà celle qui s'applique. */
  | { action: 'none' }
  /** Enregistrement sans question, avec un mot discret sur ce qui vient de se passer. */
  | { action: 'auto'; scope: CheckScope; notice: string }
  /** Sélection répétée : on demande jusqu'où l'appliquer. */
  | { action: 'ask'; suggested: CheckScope; reason: string };

/**
 * Où enregistrer une sélection modifiée. La règle, dans l'ordre :
 *
 * 1. Rien n'est encore enregistré → ce sera la configuration de l'app (on le dit,
 *    sans boîte de dialogue : le premier réglage est presque toujours le bon pour tous).
 * 2. Sinon, c'est une exception → elle va sur le workflow, tous environnements
 *    confondus (dev et prod ne se règlent pas séparément).
 * 3. Sauf si la même sélection existe DÉJÀ ailleurs : deux workflows réglés pareil
 *    annoncent une règle d'équipe, pas deux exceptions. On propose alors de la
 *    remonter au palier le plus précis où la répétition se voit — groupe, puis
 *    instance, puis application.
 */
export function decideSaveScope(input: SaveDecisionInput): SaveDecision {
  const { selection, resolved, hasAnyProfile, twinFamilies, hasGroup } = input;
  if (sameSelection(selection, resolved.disabled)) return { action: 'none' };

  if (!hasAnyProfile) {
    return {
      action: 'auto',
      scope: 'global',
      notice: msg('checks.savedAsAppDefault'),
    };
  }

  if (hasGroup && twinFamilies.group > 0) {
    return {
      action: 'ask',
      suggested: 'group',
      reason: msg('checks.twinSelection', { scope: 'group', count: twinFamilies.group + 1 }),
    };
  }
  if (twinFamilies.instance > 0) {
    return {
      action: 'ask',
      suggested: 'instance',
      reason: msg('checks.twinSelection', { scope: 'instance', count: twinFamilies.instance + 1 }),
    };
  }
  if (twinFamilies.anywhere > 0) {
    return {
      action: 'ask',
      suggested: 'global',
      reason: msg('checks.twinSelection', { scope: 'global', count: twinFamilies.anywhere + 1 }),
    };
  }

  return {
    action: 'auto',
    scope: 'family',
    notice: msg('checks.savedForFamily'),
  };
}
