/**
 * Ce qu'on redit au modèle quand sa proposition ne passe pas la porte.
 *
 * L'assistant a `check_workflow`, mais rien ne l'oblige à s'en servir, et surtout
 * rien ne garantit que les opérations qu'il RECOPIE dans sa réponse finale sont
 * celles qu'il a vérifiées : il les sérialise deux fois, et la seconde n'est
 * contrôlée par personne avant que l'humain n'ouvre le diff. Le refus arrivait
 * donc à l'écran — un diff inapplicable, un tour perdu, et une conversation à
 * relancer à la main pour dire ce que la plateforme savait déjà.
 *
 * D'où ce texte : le verdict de la porte, rendu au modèle comme une demande de
 * correction, dans le même tour. Il est écrit à l'impératif et ne laisse pas le
 * choix de discuter — un modèle à qui l'on décrit un problème répond volontiers
 * qu'il le comprend, sans renvoyer les opérations.
 */

import { GateVerdict } from './proposal-gate';
import { CheckFinding } from './structural-checks';

/**
 * Passes de correction accordées à un tour. Deux : la première rattrape la faute
 * ordinaire (un nom de nœud, une sous-clé), la seconde le cas où la correction
 * en a introduit une autre. Au-delà, le modèle tourne en rond et chaque passe se
 * paie en attente — mieux vaut rendre le refus à l'humain, qui saura reformuler.
 */
export const MAX_REPAIR_ROUNDS = 2;

function renderFindings(findings: CheckFinding[]): string {
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.code}${finding.nodeName ? ` (${finding.nodeName})` : ''} : ${finding.message}`,
    )
    .join('\n');
}

/**
 * La demande de correction, ou `null` si la proposition passe. Le verdict suffit
 * à décider : `blocked` est exactement « ce JSON ne sera pas écrit ».
 */
export function repairRequest(verdict: GateVerdict): string | null {
  if (!verdict.blocked) return null;

  const parts = [
    'STOP — ta proposition a été appliquée à une copie du workflow et la plateforme REFUSE de ' +
      "l'écrire dans n8n. Elle ne sera pas montrée à l'utilisateur en l'état.",
    verdict.reason ?? '',
  ];

  if (verdict.breaches.length > 0) {
    parts.push(
      `Le workflow ne tournerait plus (refus non contournable) :\n` +
        verdict.breaches.map((breach) => `- ${breach.message}`).join('\n'),
    );
  }
  if (verdict.refusals.length > 0) {
    parts.push(
      `n8n refusera d'enregistrer le FICHIER entier, même si ce n'est pas ta modification qui l'a ` +
        `posé — corrige-le dans le même brouillon :\n${renderFindings(verdict.refusals)}`,
    );
  }
  const errors = verdict.introduced.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    parts.push(`Erreurs introduites par tes opérations :\n${renderFindings(errors)}`);
  }

  parts.push(
    'Corrige, puis renvoie une réponse au format habituel avec les opérations COMPLÈTES et ' +
      'corrigées dans `proposal` — pas un extrait, pas un commentaire : le champ est repris tel ' +
      'quel. Vérifie-les avec `check_workflow` avant de répondre, et lis les nœuds concernés avec ' +
      '`read_node` ou `describe_node_type` plutôt que de deviner ce qui manque. ' +
      "Si tu ne sais pas corriger, renvoie `proposal: null` et dis en une ligne ce qu'il te manque : " +
      'une proposition inapplicable ne vaut rien.',
  );
  return parts.filter(Boolean).join('\n\n');
}

/** Ce qu'on dit à l'humain sous la réponse, selon ce que la correction a donné. */
export function repairNote(outcome: 'repaired' | 'gave-up' | 'abandoned', attempts: number): string {
  if (outcome === 'repaired') {
    return (
      `> 🔁 La première version de cette modification était refusée par les contrôles ; ` +
      `elle a été corrigée et revérifiée avant de t'être proposée ` +
      `(${attempts} passe${attempts > 1 ? 's' : ''}).`
    );
  }
  if (outcome === 'abandoned') {
    return (
      `> 🔁 La modification proposée était refusée par les contrôles et la correction n'a rien ` +
      `donné : la demande a été abandonnée plutôt que de te faire relire un diff inapplicable.`
    );
  }
  return (
    `> 🔁 Cette modification a été reprise ${attempts} fois et reste refusée par les contrôles. ` +
    `Elle est affichée telle quelle pour que tu voies ce qui bloque — reformule la demande.`
  );
}
