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
import { msg } from '../../i18n';

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
        `- [${finding.severity}] ${finding.code}${finding.nodeName ? ` (${finding.nodeName})` : ''}: ${finding.message}`,
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
    'STOP — your proposal was applied to a copy of the workflow and the platform REFUSES to ' +
      'write it to n8n. It will not be shown to the user as it stands.',
    verdict.reason ?? '',
  ];

  if (verdict.breaches.length > 0) {
    parts.push(
      `The workflow would no longer run (refusal that cannot be overridden):\n` +
        verdict.breaches.map((breach) => `- ${breach.message}`).join('\n'),
    );
  }
  if (verdict.refusals.length > 0) {
    parts.push(
      `n8n will refuse to save the ENTIRE FILE, even if your change is not what introduced it ` +
        `— fix it in the same draft:\n${renderFindings(verdict.refusals)}`,
    );
  }
  const errors = verdict.introduced.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    parts.push(`Errors introduced by your operations:\n${renderFindings(errors)}`);
  }

  parts.push(
    'Fix them, then send back a reply in the usual format with the COMPLETE, corrected ' +
      'operations in `proposal` — not an excerpt, not a comment: the field is taken as is. ' +
      'Check them with `check_workflow` before replying, and read the nodes involved with ' +
      '`read_node` or `describe_node_type` rather than guessing what is missing. ' +
      'If you cannot fix it, return `proposal: null` and say in one line what you are missing: ' +
      'a proposal that cannot be applied is worthless.',
  );
  return parts.filter(Boolean).join('\n\n');
}

/** Ce qu'on dit à l'humain sous la réponse, selon ce que la correction a donné. */
export function repairNote(outcome: 'repaired' | 'gave-up' | 'abandoned', attempts: number): string {
  if (outcome === 'repaired') return msg('chat.repairNoteRepaired', { attempts });
  if (outcome === 'abandoned') return msg('chat.repairNoteAbandoned');
  return msg('chat.repairNoteGaveUp', { attempts });
}
