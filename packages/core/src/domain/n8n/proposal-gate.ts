/**
 * Ce qu'une modification proposée CASSE, et si ça suffit à la refuser.
 *
 * Trois idées, et une seule règle chacune. D'abord on ne compte que les findings
 * que la modification INTRODUIT : un workflow déjà rouge bloquerait sinon tout
 * ce qu'on lui fait, et la porte ne servirait qu'à être contournée. Ensuite une
 * `error` introduite arrête la proposition PARTOUT, dev compris : l'environnement
 * ne pèse plus que sur la formulation du refus. Il décidait du refus lui-même, et
 * en dev tout passait — or un workflow de dev est celui qu'on promeut ensuite, et
 * ce qui casse s'y voyait sans jamais rien arrêter.
 *
 * Une exception à la première règle : ce que n8n lui-même REFUSERA d'écrire
 * (`WRITE_REFUSING_CODES`). Là on juge le workflow candidat en entier, sans se
 * demander qui a posé la faute — n8n rejette le fichier, pas la ligne, et
 * l'auteur d'aujourd'hui hérite du refus de celui d'hier.
 *
 * Enfin, et c'est ce qui échappe à `force` : une atteinte à l'intégrité
 * (`checkWorkflowIntegrity`) refuse l'écriture partout, quel que soit l'env et
 * quelle que soit la case cochée. Pousser un workflow non vérifié est une
 * décision qu'un humain peut prendre ; pousser un workflow que n8n ne saura pas
 * exécuter n'en est pas une.
 */

import { msg } from '../../i18n';
import { CheckFinding } from './structural-checks';
import { IntegrityBreach } from './workflow-integrity';
import { EnvName } from '../env';

/**
 * Findings qui ne parlent pas de la QUALITÉ du workflow mais de la possibilité
 * même de l'écrire : n8n refuse le PUT, et il refuse le workflow ENTIER.
 *
 * C'est ce qui les sort de la règle « on ne compte que ce que la modification
 * introduit ». Une sous-clé de collection non déclarée posée par quelqu'un
 * d'autre, il y a trois mois, dans un nœud auquel on ne touche pas, fait quand
 * même échouer toute écriture — n8n répond « Could not find property option »
 * sans dire quel nœud. Ne la signaler que si la modification l'introduit
 * revenait à laisser l'assistant proposer, l'humain relire, puis découvrir le
 * refus au clic, sans nulle part où le rattacher.
 */
export const WRITE_REFUSING_CODES = new Set(['node-unknown-collection-key']);

/** Ce qui, dans le workflow candidat, fera refuser l'écriture par n8n. */
export function writeRefusingFindings(after: CheckFinding[]): CheckFinding[] {
  const seen = new Set<string>();
  return after.filter((finding) => {
    if (!WRITE_REFUSING_CODES.has(finding.code)) return false;
    const key = fingerprint(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deux findings sont « le même » s'ils disent la même chose du même nœud. */
function fingerprint(finding: CheckFinding): string {
  return `${finding.code}|${finding.nodeName ?? ''}|${finding.message}`;
}

/**
 * Findings présents après et absents avant. Comparaison en multi-ensemble : deux
 * occurrences identiques avant et trois après laissent bien une nouvelle.
 */
export function introducedFindings(before: CheckFinding[], after: CheckFinding[]): CheckFinding[] {
  const remaining = new Map<string, number>();
  for (const finding of before) {
    const key = fingerprint(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const introduced: CheckFinding[] = [];
  for (const finding of after) {
    const key = fingerprint(finding);
    const count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1);
    else introduced.push(finding);
  }
  return introduced;
}

/**
 * L'environnement du point de vue du garde-fou. Un workflow sans env déclaré
 * mais ACTIF est traité comme de la prod : le mauvais défaut serait l'inverse,
 * il laisserait passer une modification sur ce qui tourne pour de vrai.
 */
export function gateEnv(env: EnvName | null, active: boolean): 'prod' | 'safe' {
  if (env === 'prod') return 'prod';
  if (env) return 'safe';
  return active ? 'prod' : 'safe';
}

export interface GateVerdict {
  /** La proposition est refusée : elle casserait quelque chose là où ça compte. */
  blocked: boolean;
  /**
   * Ce qui refuse. `integrity` ne se contourne pas — l'UI n'offre alors aucune
   * case, et l'API refuse même si `force` est passé. `refusal` se contourne,
   * mais pour rien : c'est n8n qui refusera l'écriture derrière.
   */
  blockedBy?: 'integrity' | 'quality' | 'refusal';
  /** Atteintes à l'intégrité introduites par la modification (jamais contournables). */
  breaches: IntegrityBreach[];
  /** Findings introduits par la modification, quelle que soit l'issue. */
  introduced: CheckFinding[];
  /**
   * Ce que porte le workflow CANDIDAT et qui fera refuser l'écriture par n8n,
   * que la modification en soit l'auteur ou non (cf. `WRITE_REFUSING_CODES`).
   */
  refusals: CheckFinding[];
  /** Dit à l'humain ce qui bloque, ou ce qui passe malgré tout. */
  reason?: string;
}

export interface GateOptions {
  env: EnvName | null;
  active: boolean;
  /**
   * Contournement explicite, coché par un humain — jamais un défaut. Ne lève que
   * la vérification : les atteintes à l'intégrité lui sont insensibles.
   */
  force?: boolean;
  /** Ce que la modification casse structurellement (cf. `checkWorkflowIntegrity`). */
  breaches?: IntegrityBreach[];
}

export function evaluateProposalGate(
  before: CheckFinding[],
  after: CheckFinding[],
  options: GateOptions,
): GateVerdict {
  const introduced = introducedFindings(before, after);
  const breaches = options.breaches ?? [];
  const refusals = writeRefusingFindings(after);

  // L'intégrité passe avant tout le reste, et avant `force` : ce n'est pas un
  // avis sur la qualité du workflow, c'est le constat qu'il ne tournerait plus.
  if (breaches.length > 0) {
    return {
      blocked: true,
      blockedBy: 'integrity',
      breaches,
      introduced,
      refusals,
      reason: msg('edit.gateIntegrity', { details: breaches.map((breach) => breach.message).join(' ') }),
    };
  }

  // Ce que n8n refusera d'écrire, qu'on en soit l'auteur ou non. Rien à voir avec
  // l'environnement : n8n refuse aussi bien le workflow de dev que celui de prod,
  // et il refuse le fichier ENTIER. Passer outre est possible — notre lecture du
  // schéma peut se tromper — mais ne gagne rien quand elle a raison : le PUT
  // revient en 400 « Could not find property option », sans nommer le nœud.
  if (refusals.length > 0) {
    const detail = refusals.map((finding) => finding.message).join(' ');
    if (!options.force) {
      return {
        blocked: true,
        blockedBy: 'refusal',
        breaches,
        introduced,
        refusals,
        reason: msg('edit.gateRefusal', { detail }),
      };
    }
  }

  const errors = introduced.filter((finding) => finding.severity === 'error');
  if (errors.length === 0) {
    return { blocked: false, breaches, introduced, refusals };
  }

  // Le socle : une `error` introduite refuse l'écriture PARTOUT, dev compris.
  // L'environnement ne change plus que le ton du message — il décidait avant du
  // refus lui-même, et le workflow de dev d'aujourd'hui est celui qu'on promeut
  // demain : ce qui casse s'y voyait, sans jamais rien arrêter.
  const detail = errors
    .map((finding) => `${finding.code} — ${finding.message}`)
    .join(msg('edit.clauseSeparator'));
  if (options.force) {
    return {
      blocked: false,
      breaches,
      introduced,
      refusals,
      reason: msg('edit.gateForced', { count: errors.length, detail }),
    };
  }
  const prod = gateEnv(options.env, options.active) === 'prod';
  return {
    blocked: true,
    blockedBy: 'quality',
    breaches,
    introduced,
    refusals,
    reason: msg('edit.gateQuality', { prod, count: errors.length, detail }),
  };
}
