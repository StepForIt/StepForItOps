import { msg } from '../../i18n';
import { BumpLevel } from '../semver';
import { WorkflowDiff } from './workflow-diff';
import { isStickyNote, isTriggerNode } from './workflow-graph';

export interface BumpProposal {
  level: BumpLevel;
  /** Une phrase : ce qui, dans le changement, décide du digit. */
  reason: string;
}

/** Champs d'un nœud dont le changement ne change rien à ce que le workflow FAIT. */
const COSMETIC_FIELDS = new Set(['position', 'notes', 'notesInFlow', 'color', 'id']);

/**
 * Quel digit un changement mérite, décidé sur le diff et rien d'autre. Sert de
 * proposition par défaut ET de repli quand l'IA est absente ou muette : le niveau
 * ne doit jamais dépendre de la disponibilité d'une clé API.
 *
 * La ligne de partage est ce que le changement fait au CONTRAT du workflow — son
 * déclencheur, son nom, ce qu'il ne fait plus — puis à ce qu'il fait de plus.
 */
export function suggestBumpLevel(diff: WorkflowDiff): BumpProposal {
  const nodes = diff.nodes.filter((node) => !isStickyNote({ type: node.nodeType }));

  const removed = nodes.filter((node) => node.change === 'removed');
  if (removed.length > 0) {
    return {
      level: 'major',
      reason: msg('edit.bumpRemoved', {
        count: removed.length,
        names: removed.map((n) => n.name).join(', '),
      }),
    };
  }

  // Un trigger déplacé sur le canevas n'est pas un contrat qui change : seul compte
  // ce qui touche à son déclenchement (URL de webhook, planning cron, type de nœud).
  const triggers = nodes.filter(
    (node) =>
      isTriggerNode({ type: node.nodeType }) &&
      (node.change !== 'modified' || node.fields.some((field) => !COSMETIC_FIELDS.has(field))),
  );
  if (triggers.length > 0) {
    return {
      level: 'major',
      reason: msg('edit.bumpTrigger', { names: triggers.map((n) => n.name).join(', ') }),
    };
  }

  if (diff.nameChange) {
    return {
      level: 'major',
      reason: msg('edit.bumpRenamed', { before: diff.nameChange.before, after: diff.nameChange.after }),
    };
  }

  const added = nodes.filter((node) => node.change === 'added');
  if (added.length > 0) {
    return {
      level: 'minor',
      reason: msg('edit.bumpAdded', { count: added.length, names: added.map((n) => n.name).join(', ') }),
    };
  }

  if (diff.connections.changed) {
    return {
      level: 'minor',
      reason: msg('edit.bumpWiring'),
    };
  }

  const substantial = nodes.filter(
    (node) => node.change !== 'renamed' && node.fields.some((field) => !COSMETIC_FIELDS.has(field)),
  );
  if (substantial.length > 0) {
    return {
      level: 'patch',
      reason: msg('edit.bumpSettings', {
        count: substantial.length,
        names: substantial.map((n) => n.name).join(', '),
      }),
    };
  }

  return {
    level: 'patch',
    reason: diff.hasChanges ? msg('edit.bumpCosmetic') : msg('edit.bumpIdentical'),
  };
}

const RANK: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };
const BY_RANK: BumpLevel[] = ['patch', 'minor', 'major'];

/**
 * Plus haut niveau qu'un avis d'IA peut proposer : un cran au-dessus de la règle.
 * L'IA lit ce que la règle ne sait pas lire (« ce paramètre change le destinataire »),
 * mais elle ne décide pas seule d'une majeure sur un réglage : c'est la règle qui dit
 * si quelque chose a disparu ou si le point d'entrée a bougé, et une réponse qui
 * interprète un libellé d'affichage comme un contrat brisé saute deux crans d'un coup.
 */
export function aiBumpCeiling(rules: BumpLevel): BumpLevel {
  return BY_RANK[Math.min(RANK[rules] + 1, BY_RANK.length - 1)];
}

/** Le niveau proposé par l'IA, ramené sous le plafond ; `capped` dit s'il a fallu le faire. */
export function capAiBump(rules: BumpLevel, proposed: BumpLevel): { level: BumpLevel; capped: boolean } {
  const ceiling = aiBumpCeiling(rules);
  return RANK[proposed] > RANK[ceiling]
    ? { level: ceiling, capped: true }
    : { level: proposed, capped: false };
}
